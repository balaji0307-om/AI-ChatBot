import asyncio
import json
import os
import secrets
from hashlib import pbkdf2_hmac
from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from pymongo import MongoClient

load_dotenv(override=True)

for proxy_var in (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
):
    if os.getenv(proxy_var, "").strip() == "http://127.0.0.1:9":
        os.environ.pop(proxy_var, None)

DEFAULT_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").strip()
MONGODB_URI = os.getenv("MONGODB_URI").strip()
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "nova_scribe").strip()

SYSTEM_INSTRUCTION = """You are NovaScribe, a helpful AI assistant in a chat app.
Write answers in a natural, human style.
Do not use labels like "Brief Answer", "Key Points", or "Next Step".
When useful, add short bullets or mini-headings such as "Quick details" or "Career highlights".
Keep answers clean, readable, and informative.
Do not end every answer with a follow-up suggestion unless the user asks for more.
"""

FALLBACK_RESPONSES = {
    "pointer": """A pointer is a variable that stores the memory address of another variable. It is mainly used in C and C++ for direct memory access, dynamic memory allocation, and efficient data handling.

Types of pointers:
- Null pointer: points to nothing and is usually set to `NULL` or `nullptr`.
- Wild pointer: declared but not initialized.
- Void pointer: can store the address of any data type.
- Dangling pointer: points to memory that has already been freed.
- Function pointer: stores the address of a function.

Important operators:
- `&` gives the address of a variable.
- `*` dereferences the pointer and gives the value at that address.""",
    "default": """NovaScribe could not reach Gemini right now because all configured API keys are out of quota or rate-limited. Your chat app and database are connected correctly, but the live model response is currently unavailable.

What this means:
- The app itself is working.
- The issue is with Gemini API usage limits.
- You can wait for quota reset, enable billing, or add more API keys from different Google projects.""",
}

app = FastAPI(title="NovaScribe API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

mongo_client = MongoClient(MONGODB_URI)
mongo_db = mongo_client[MONGODB_DB_NAME]
chat_collection = mongo_db["chats"]
user_collection = mongo_db["users"]
session_collection = mongo_db["sessions"]


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(system|user|assistant)$")
    content: str = Field(min_length=1)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
    model: str | None = None
    temperature: float = Field(default=0.6, ge=0.0, le=2.0)
    simulate_stream: bool = False


class CreateChatRequest(BaseModel):
    title: str | None = None


class SendMessageRequest(BaseModel):
    content: str = Field(min_length=1)
    model: str | None = None
    temperature: float = Field(default=0.6, ge=0.0, le=2.0)
    simulate_stream: bool = False


class SignupRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=5, max_length=120)
    password: str = Field(min_length=6, max_length=120)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=120)
    password: str = Field(min_length=6, max_length=120)


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _normalize_email(value: str) -> str:
    return value.strip().lower()


def _create_indexes() -> None:
    user_collection.create_index("email", unique=True)
    session_collection.create_index("token", unique=True)
    session_collection.create_index("user_id")
    session_collection.create_index("created_at")
    chat_collection.create_index("owner_id")
    chat_collection.create_index("updated_at")
    chat_collection.create_index([("owner_id", 1), ("updated_at", -1)])
    chat_collection.create_index([("title", "text"), ("messages.content", "text")])


_create_indexes()


def _hash_password(password: str, salt: str | None = None) -> str:
    resolved_salt = salt or secrets.token_hex(16)
    digest = pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        resolved_salt.encode("utf-8"),
        120000,
    ).hex()
    return f"{resolved_salt}${digest}"


def _verify_password(password: str, password_hash: str) -> bool:
    if "$" not in password_hash:
        return False
    salt, stored_digest = password_hash.split("$", 1)
    candidate = _hash_password(password, salt)
    return candidate.split("$", 1)[1] == stored_digest


def _new_session(user_id: ObjectId) -> dict[str, Any]:
    token = secrets.token_urlsafe(32)
    document = {
        "user_id": user_id,
        "token": token,
        "created_at": _utc_now(),
    }
    session_collection.insert_one(document)
    return document


def _serialize_user(document: dict[str, Any]) -> dict[str, str]:
    return {
        "id": str(document["_id"]),
        "name": document["name"],
        "email": document["email"],
        "created_at": document.get("created_at").isoformat() if document.get("created_at") else "",
    }


def _resolve_session_token(
    x_session_token: str | None,
    authorization: str | None,
) -> str | None:
    if x_session_token and x_session_token.strip():
        return x_session_token.strip()
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip()
    return None


def _get_user_or_401(
    x_session_token: str | None,
    authorization: str | None,
) -> dict[str, Any]:
    token = _resolve_session_token(x_session_token, authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    session = session_collection.find_one({"token": token})
    if not session:
        raise HTTPException(status_code=401, detail="Unauthorized")
    user = user_collection.find_one({"_id": session["user_id"]})
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user


def _get_api_keys() -> list[str]:
    multi_key_value = os.getenv("GEMINI_API_KEYS", "").strip()
    if multi_key_value:
        keys = [key.strip() for key in multi_key_value.split(",") if key.strip()]
        if keys:
            return keys

    single_key = os.getenv("GEMINI_API_KEY", "").strip()
    if single_key:
        return [single_key]

    return []


def _get_client(api_key: str | None = None) -> genai.Client:
    resolved_key = (api_key or "").strip()
    if not resolved_key:
        keys = _get_api_keys()
        if not keys:
            raise ValueError("Missing GEMINI_API_KEY or GEMINI_API_KEYS in backend environment.")
        resolved_key = keys[0]
    return genai.Client(api_key=resolved_key)


def _api_key_suffix() -> str:
    keys = _get_api_keys()
    if not keys:
        return ""
    return keys[0][-4:]


def _api_key_count() -> int:
    return len(_get_api_keys())


def _build_prompt(messages: list[dict[str, str]]) -> str:
    formatted = []
    for msg in messages:
        role_label = msg["role"].upper()
        formatted.append(f"{role_label}: {msg['content'].strip()}")
    return (
        "Use the following conversation and answer only the latest USER request.\n\n"
        + "\n".join(formatted)
    )


def _friendly_error(error: Exception) -> str:
    message = str(error)
    if "RESOURCE_EXHAUSTED" in message or "quota" in message.lower() or "429" in message:
        return (
            "Gemini quota is exhausted for this API key. "
            "Your app is connected; wait for quota reset, enable billing, or use another Gemini API key."
        )
    return message


def _fallback_answer(prompt: str) -> str:
    lowered = prompt.lower()
    if "pointer" in lowered:
        return FALLBACK_RESPONSES["pointer"]
    return FALLBACK_RESPONSES["default"]


def _message_doc(role: str, content: str) -> dict[str, Any]:
    return {
        "role": role,
        "content": content,
        "created_at": _utc_now(),
    }


def _derive_title(text: str) -> str:
    cleaned = " ".join(text.strip().split())
    if not cleaned:
        return "New chat"
    return cleaned[:48] + ("..." if len(cleaned) > 48 else "")


def _serialize_message(message: dict[str, Any]) -> dict[str, str]:
    return {
        "role": message["role"],
        "content": message["content"],
    }


def _serialize_chat(document: dict[str, Any], include_messages: bool = False) -> dict[str, Any]:
    payload = {
        "id": str(document["_id"]),
        "owner_id": str(document.get("owner_id")) if document.get("owner_id") else "",
        "title": document.get("title", "New chat"),
        "model": document.get("model", DEFAULT_GEMINI_MODEL),
        "created_at": document.get("created_at").isoformat() if document.get("created_at") else "",
        "updated_at": document.get("updated_at").isoformat() if document.get("updated_at") else "",
    }
    if include_messages:
        payload["messages"] = [_serialize_message(message) for message in document.get("messages", [])]
    return payload


def _get_chat_or_404(chat_id: str, owner_id: str) -> dict[str, Any]:
    if not ObjectId.is_valid(chat_id):
        raise HTTPException(status_code=404, detail="Chat not found")
    document = chat_collection.find_one({"_id": ObjectId(chat_id), "owner_id": ObjectId(owner_id)})
    if not document:
        raise HTTPException(status_code=404, detail="Chat not found")
    return document


async def _generate_gemini_events(
    *, prompt: str, model_name: str, temperature: float, simulate_stream: bool
):
    async def simulate(text: str):
        words = text.split(" ")
        for word in words:
            if not word:
                continue
            yield {"type": "chunk", "value": f"{word} "}
            await asyncio.sleep(0.02)
        yield {"type": "done", "value": ""}

    keys = _get_api_keys()
    if not keys:
        yield {"type": "error", "value": "Missing GEMINI_API_KEY or GEMINI_API_KEYS in backend environment."}
        return

    last_error = ""
    quota_or_rate_limited = False

    for index, api_key in enumerate(keys):
        client = _get_client(api_key)
        try:
            config = types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                temperature=temperature,
            )

            if simulate_stream:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=config,
                )
                text = (response.text or "").strip()
                async for event in simulate(text):
                    yield event
                if index > 0:
                    yield {"type": "soft_notice", "value": f"Used backup Gemini API key #{index + 1}."}
                return

            try:
                stream = client.models.generate_content_stream(
                    model=model_name,
                    contents=prompt,
                    config=config,
                )
                for chunk in stream:
                    text = getattr(chunk, "text", "") or ""
                    if text:
                        yield {"type": "chunk", "value": text}
                        await asyncio.sleep(0)
                yield {"type": "done", "value": ""}
                if index > 0:
                    yield {"type": "soft_notice", "value": f"Used backup Gemini API key #{index + 1}."}
                return
            except Exception:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=config,
                )
                text = (response.text or "").strip()
                async for event in simulate(text):
                    yield event
                if index > 0:
                    yield {"type": "soft_notice", "value": f"Used backup Gemini API key #{index + 1}."}
                return
        except Exception as error:
            friendly = _friendly_error(error)
            last_error = friendly
            lowered = friendly.lower()
            if (
                "quota" in lowered
                or "resource_exhausted" in lowered
                or "429" in lowered
                or "rate limit" in lowered
            ):
                quota_or_rate_limited = True
                continue
            yield {"type": "error", "value": friendly}
            return

    if quota_or_rate_limited:
        async for event in simulate(_fallback_answer(prompt)):
            yield event
        yield {
            "type": "soft_notice",
            "value": (
                "All configured Gemini API keys are currently rate-limited or out of quota. "
                "The app used a local fallback response."
            ),
        }
        return

    yield {"type": "error", "value": last_error or "Gemini request failed."}


def _sse_chunk(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=True)}\n\n"


async def _stream_prompt_as_sse(*, prompt: str, model_name: str, temperature: float, simulate_stream: bool):
    async for event in _generate_gemini_events(
        prompt=prompt,
        model_name=model_name,
        temperature=temperature,
        simulate_stream=simulate_stream,
    ):
        yield _sse_chunk(event)


async def _stream_chat_reply(
    chat_id: str,
    owner_id: str,
    user_message: str,
    model_name: str,
    temperature: float,
    simulate_stream: bool,
):
    document = _get_chat_or_404(chat_id, owner_id)
    existing_messages = [_serialize_message(message) for message in document.get("messages", [])]
    user_doc = _message_doc("user", user_message)
    conversation = existing_messages + [{"role": "user", "content": user_message}]
    prompt = _build_prompt(conversation)

    assistant_text_parts: list[str] = []
    saw_error = False

    async for event in _generate_gemini_events(
        prompt=prompt,
        model_name=model_name,
        temperature=temperature,
        simulate_stream=simulate_stream,
    ):
        if event["type"] == "chunk":
            assistant_text_parts.append(event["value"])
        if event["type"] == "error":
            saw_error = True
        yield _sse_chunk(event)

    if saw_error:
        return

    assistant_text = "".join(assistant_text_parts).strip()
    if not assistant_text:
        return

    assistant_doc = _message_doc("assistant", assistant_text)
    title = document.get("title", "New chat")
    if title == "New chat" and user_message.strip():
        title = _derive_title(user_message)

    chat_collection.update_one(
        {"_id": document["_id"]},
        {
            "$push": {"messages": {"$each": [user_doc, assistant_doc]}},
            "$set": {
                "updated_at": _utc_now(),
                "title": title,
                "model": model_name,
            },
        },
    )


@app.get("/api/health")
def health_check():
    has_api_key = bool(_get_api_keys())
    mongo_connected = False
    try:
        mongo_client.admin.command("ping")
        mongo_connected = True
    except Exception:
        mongo_connected = False

    return {
        "status": "ok",
        "provider": "gemini",
        "product_name": "NovaScribe",
        "model": DEFAULT_GEMINI_MODEL,
        "has_api_key": has_api_key,
        "api_key_suffix": _api_key_suffix(),
        "api_key_count": _api_key_count(),
        "mongodb_connected": mongo_connected,
    }


@app.post("/api/auth/signup")
def signup(payload: SignupRequest):
    email = _normalize_email(payload.email)
    existing = user_collection.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="Account already exists. Please log in.")

    document = {
        "name": payload.name.strip(),
        "email": email,
        "password_hash": _hash_password(payload.password),
        "created_at": _utc_now(),
    }
    result = user_collection.insert_one(document)
    created = user_collection.find_one({"_id": result.inserted_id})
    session = _new_session(created["_id"])
    return {"user": _serialize_user(created), "session_token": session["token"]}


@app.post("/api/auth/login")
def login(payload: LoginRequest):
    email = _normalize_email(payload.email)
    user = user_collection.find_one({"email": email})
    if not user or not _verify_password(payload.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    session = _new_session(user["_id"])
    return {"user": _serialize_user(user), "session_token": session["token"]}


@app.get("/api/auth/me")
def me(
    x_session_token: str | None = Header(default=None, alias="X-Session-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
):
    user = _get_user_or_401(x_session_token, authorization)
    return {"user": _serialize_user(user)}


@app.post("/api/auth/logout")
def logout(
    x_session_token: str | None = Header(default=None, alias="X-Session-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
):
    token = _resolve_session_token(x_session_token, authorization)
    if token:
        session_collection.delete_one({"token": token})
    return {"ok": True}


@app.get("/api/chats")
def list_chats(
    q: str = "",
    x_session_token: str | None = Header(default=None, alias="X-Session-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
):
    user = _get_user_or_401(x_session_token, authorization)
    query: dict[str, Any] = {"owner_id": user["_id"]}
    if q.strip():
        regex = {"$regex": q.strip(), "$options": "i"}
        query = {
            "owner_id": user["_id"],
            "$or": [
                {"title": regex},
                {"messages.content": regex},
            ]
        }

    documents = chat_collection.find(query).sort("updated_at", -1).limit(100)
    return {"items": [_serialize_chat(document) for document in documents]}


@app.post("/api/chats")
def create_chat(
    payload: CreateChatRequest,
    x_session_token: str | None = Header(default=None, alias="X-Session-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
):
    user = _get_user_or_401(x_session_token, authorization)
    now = _utc_now()
    title = payload.title.strip() if payload.title else "New chat"
    document = {
        "owner_id": user["_id"],
        "title": title or "New chat",
        "model": DEFAULT_GEMINI_MODEL,
        "messages": [],
        "created_at": now,
        "updated_at": now,
    }
    result = chat_collection.insert_one(document)
    created = chat_collection.find_one({"_id": result.inserted_id})
    return _serialize_chat(created, include_messages=True)


@app.get("/api/chats/{chat_id}")
def get_chat(
    chat_id: str,
    x_session_token: str | None = Header(default=None, alias="X-Session-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
):
    user = _get_user_or_401(x_session_token, authorization)
    document = _get_chat_or_404(chat_id, str(user["_id"]))
    return _serialize_chat(document, include_messages=True)


@app.post("/api/chats/{chat_id}/messages/stream")
async def send_message(
    chat_id: str,
    payload: SendMessageRequest,
    x_session_token: str | None = Header(default=None, alias="X-Session-Token"),
    authorization: str | None = Header(default=None, alias="Authorization"),
):
    user = _get_user_or_401(x_session_token, authorization)
    document = _get_chat_or_404(chat_id, str(user["_id"]))
    model_name = (payload.model or document.get("model") or DEFAULT_GEMINI_MODEL).strip()
    return StreamingResponse(
        _stream_chat_reply(
            chat_id=chat_id,
            owner_id=str(user["_id"]),
            user_message=payload.content,
            model_name=model_name,
            temperature=payload.temperature,
            simulate_stream=payload.simulate_stream,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/chat/stream")
async def chat_stream(payload: ChatRequest):
    try:
        model_name = (payload.model or DEFAULT_GEMINI_MODEL).strip()
        prompt = _build_prompt([{"role": msg.role, "content": msg.content} for msg in payload.messages])

        return StreamingResponse(
            _stream_prompt_as_sse(
                prompt=prompt,
                model_name=model_name,
                temperature=payload.temperature,
                simulate_stream=payload.simulate_stream,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})
