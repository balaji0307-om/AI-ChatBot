# NovaScribe AI Chat App

This project is a full-stack AI chat application:

- Frontend: React + Tailwind CSS (`frontend`)
- Backend: FastAPI (`backend`)
- Database: MongoDB
- LLM Provider: Google Gemini API (`google-genai` SDK)
- Response mode: real-time streaming via Server-Sent Events

## 1) Backend setup

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Update `backend/.env` with your real Gemini API key:

```env
GEMINI_API_KEY=your_real_key_here
GEMINI_API_KEYS=your_first_key_here,your_second_key_here
GEMINI_MODEL=gemini-2.5-flash
FRONTEND_ORIGIN=http://localhost:5173
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=nova_scribe
```

If you want smart fallback across multiple keys, set `GEMINI_API_KEYS` as a comma-separated list. The backend will try each key in order and automatically move to the next one when a key hits quota or rate limits.

Run backend:

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 9000
```

## 2) Frontend setup

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Frontend runs at `http://localhost:5173`.

## 3) API endpoints

- `GET http://127.0.0.1:9000/api/health` -> health check
- `GET http://127.0.0.1:9000/api/chats` -> list and search chats
- `POST http://127.0.0.1:9000/api/chats` -> create a new chat
- `GET http://127.0.0.1:9000/api/chats/{chat_id}` -> load a saved chat
- `POST http://127.0.0.1:9000/api/chats/{chat_id}/messages/stream` -> stream and save replies
- `POST http://127.0.0.1:9000/api/chat/stream` -> stateless streamed chat response

Saved chat request payload example:

```json
{
  "content": "Explain API testing in simple terms.",
  "model": "gemini-2.5-flash",
  "temperature": 0.6,
  "simulate_stream": false
}
```

## 4) Notes

- Conversation history is stored in MongoDB.
- Search works across chat titles and saved message text.
- If all Gemini keys hit quota, the app falls back to a local response instead of breaking.
