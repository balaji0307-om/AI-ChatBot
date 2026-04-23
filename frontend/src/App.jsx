import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const AUTH_STORAGE_KEY = "nova_scribe_user";

const MODEL_OPTIONS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-3-flash-preview"
];

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return String(Date.now() + Math.random());
}

function LogoMark() {
  return (
    <div className="logo-mark" aria-hidden="true">
      <div className="logo-core">
        <div className="logo-tip" />
        <div className="logo-line" />
      </div>
    </div>
  );
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function loadStoredUser() {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [authMode, setAuthMode] = useState("signup");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [currentUser, setCurrentUser] = useState(() => loadStoredUser());

  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isBooting, setIsBooting] = useState(true);
  const [selectedModel, setSelectedModel] = useState(MODEL_OPTIONS[0]);
  const [errorText, setErrorText] = useState("");
  const [statusText, setStatusText] = useState("Connected workspace");
  const abortRef = useRef(null);
  const bottomRef = useRef(null);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? null,
    [activeChatId, chats]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  useEffect(() => {
    if (!currentUser) {
      setChats([]);
      setActiveChatId("");
      setMessages([]);
      setIsBooting(false);
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      setIsBooting(true);
      try {
        const data = await fetchJson(`${API_BASE}/api/chats`, {
          headers: authHeaders(currentUser)
        });
        if (cancelled) return;

        if (!data.items.length) {
          const created = await createChat(currentUser);
          if (cancelled) return;
          setChats([created]);
          setActiveChatId(created.id);
          setMessages([]);
          setSelectedModel(created.model || MODEL_OPTIONS[0]);
        } else {
          setChats(data.items);
          setActiveChatId(data.items[0].id);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorText(error.message || "Failed to load chat history.");
        }
      } finally {
        if (!cancelled) {
          setIsBooting(false);
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  useEffect(() => {
    if (!activeChatId || !currentUser) return;
    let cancelled = false;

    async function loadChat() {
      try {
        const chat = await fetchJson(`${API_BASE}/api/chats/${activeChatId}`, {
          headers: authHeaders(currentUser)
        });
        if (cancelled) return;
        setMessages(chat.messages || []);
        setSelectedModel(chat.model || MODEL_OPTIONS[0]);
      } catch (error) {
        if (!cancelled) {
          setErrorText(error.message || "Failed to load this chat.");
        }
      }
    }

    loadChat();
    return () => {
      cancelled = true;
    };
  }, [activeChatId, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const timer = setTimeout(async () => {
      try {
        const data = await fetchJson(
          `${API_BASE}/api/chats${searchTerm.trim() ? `?q=${encodeURIComponent(searchTerm.trim())}` : ""}`,
          { headers: authHeaders(currentUser) }
        );
        setChats(data.items || []);
      } catch (error) {
        setErrorText(error.message || "Failed to search chats.");
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [searchTerm, currentUser]);

  function authHeaders(user, extra = {}) {
    return {
      ...extra,
      "X-User-Id": user.id
    };
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
      let message = "Request failed.";
      try {
        const data = await response.json();
        message = data.error || data.detail || message;
      } catch {
        message = "Request failed.";
      }
      throw new Error(message);
    }
    return response.json();
  }

  async function refreshChats(preferredId = activeChatId) {
    if (!currentUser) return;
    const data = await fetchJson(
      `${API_BASE}/api/chats${searchTerm.trim() ? `?q=${encodeURIComponent(searchTerm.trim())}` : ""}`,
      { headers: authHeaders(currentUser) }
    );
    setChats(data.items || []);
    if (preferredId) {
      const exists = (data.items || []).some((chat) => chat.id === preferredId);
      if (!exists && data.items?.length) {
        setActiveChatId(data.items[0].id);
      }
    }
  }

  async function createChat(user) {
    return fetchJson(`${API_BASE}/api/chats`, {
      method: "POST",
      headers: {
        ...authHeaders(user),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title: "New chat" })
    });
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError("");

    const endpoint = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
    const payload =
      authMode === "signup"
        ? authForm
        : { email: authForm.email, password: authForm.password };

    try {
      const data = await fetchJson(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data.user));
      setCurrentUser(data.user);
      setAuthForm({ name: "", email: "", password: "" });
      setStatusText("Connected workspace");
      setErrorText("");
    } catch (error) {
      setAuthError(error.message || "Authentication failed.");
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    setCurrentUser(null);
    setAuthMode("login");
    setSearchTerm("");
    setInput("");
    setErrorText("");
    setStatusText("Connected workspace");
  }

  async function handleNewChat() {
    if (!currentUser) return;
    try {
      setErrorText("");
      const created = await createChat(currentUser);
      await refreshChats(created.id);
      setActiveChatId(created.id);
      setMessages([]);
      setInput("");
      setStatusText("Fresh conversation ready");
    } catch (error) {
      setErrorText(error.message || "Failed to create a new chat.");
    }
  }

  async function handleSelectChat(chatId) {
    if (isStreaming || chatId === activeChatId) return;
    setErrorText("");
    setActiveChatId(chatId);
  }

  async function streamChatResponse(chatId, payload, assistantId, signal) {
    const response = await fetch(`${API_BASE}/api/chats/${chatId}/messages/stream`, {
      method: "POST",
      headers: {
        ...authHeaders(currentUser),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal
    });

    if (!response.ok) {
      let message = "Request failed.";
      try {
        const data = await response.json();
        message = data.error || data.detail || message;
      } catch {
        message = "Request failed.";
      }
      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("Streaming is not available in this browser.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let textSoFar = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        const lines = event.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;

          const packet = JSON.parse(raw);
          if (packet.type === "chunk") {
            textSoFar += packet.value;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId ? { ...msg, content: textSoFar } : msg
              )
            );
          }
          if (packet.type === "notice") {
            setErrorText(packet.value || "Gemini returned a notice.");
          }
          if (packet.type === "soft_notice") {
            setStatusText(packet.value || "Used backup Gemini API key");
          }
          if (packet.type === "error") {
            throw new Error(packet.value || "Streaming failed.");
          }
        }
      }
    }
  }

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || isStreaming || !currentUser) return;

    try {
      setErrorText("");
      setStatusText("Thinking...");

      let chatId = activeChatId;
      if (!chatId) {
        const created = await createChat(currentUser);
        chatId = created.id;
        setActiveChatId(chatId);
        await refreshChats(chatId);
      }

      const userMessage = { id: makeId(), role: "user", content: trimmed };
      const assistantId = makeId();
      const assistantMessage = { id: assistantId, role: "assistant", content: "" };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setInput("");
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      await streamChatResponse(
        chatId,
        {
          content: trimmed,
          model: selectedModel,
          temperature: 0.6,
          simulate_stream: false
        },
        assistantId,
        controller.signal
      );

      const refreshedChat = await fetchJson(`${API_BASE}/api/chats/${chatId}`, {
        headers: authHeaders(currentUser)
      });
      setMessages(refreshedChat.messages || []);
      await refreshChats(chatId);
      setStatusText("Response complete");
    } catch (error) {
      if (error?.name !== "AbortError") {
        setErrorText(error.message || "Failed to get a response.");
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg.role === "assistant" && !msg.content
            ? { ...msg, content: "The response was interrupted. Please try again." }
            : msg
        )
      );
      setStatusText("Idle");
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setIsStreaming(false);
    setStatusText("Stopped");
  }

  function onInputKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  if (!currentUser) {
    return (
      <main className="auth-shell">
        <section className="auth-hero">
          <div className="auth-brand">
            <LogoMark />
            <div>
              <p className="brand-kicker">Intelligent conversation workspace</p>
              <h1 className="brand-title">NovaScribe</h1>
            </div>
          </div>
          <h2 className="auth-title">Create your account first, then log in anytime.</h2>
          <p className="auth-copy">
            Save conversations, search your chat history, and continue across sessions with MongoDB-backed storage.
          </p>
          <div className="auth-features">
            <div className="auth-feature">
              <span className="feature-label">Private history</span>
              <span className="feature-copy">Every account gets its own saved conversations.</span>
            </div>
            <div className="auth-feature">
              <span className="feature-label">Quick search</span>
              <span className="feature-copy">Find old chats instantly from the sidebar.</span>
            </div>
            <div className="auth-feature">
              <span className="feature-label">Gemini workspace</span>
              <span className="feature-copy">Use your configured Gemini keys with persistent chat context.</span>
            </div>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab ${authMode === "signup" ? "is-active" : ""}`}
              onClick={() => setAuthMode("signup")}
            >
              Sign up
            </button>
            <button
              type="button"
              className={`auth-tab ${authMode === "login" ? "is-active" : ""}`}
              onClick={() => setAuthMode("login")}
            >
              Log in
            </button>
          </div>

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            <div className="auth-headline">
              <h3>{authMode === "signup" ? "Create your NovaScribe account" : "Welcome back"}</h3>
              <p>
                {authMode === "signup"
                  ? "Start by signing up. Once your account exists, you can log in anytime."
                  : "Use your existing account details to continue where you left off."}
              </p>
            </div>

            {authMode === "signup" ? (
              <label className="field">
                <span>Name</span>
                <input
                  value={authForm.name}
                  onChange={(event) =>
                    setAuthForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder="Enter your name"
                  required
                />
              </label>
            ) : null}

            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={authForm.email}
                onChange={(event) =>
                  setAuthForm((prev) => ({ ...prev, email: event.target.value }))
                }
                placeholder="Enter your email"
                required
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={authForm.password}
                onChange={(event) =>
                  setAuthForm((prev) => ({ ...prev, password: event.target.value }))
                }
                placeholder="Enter your password"
                required
              />
            </label>

            {authError ? <p className="error-banner">{authError}</p> : null}

            <button type="submit" className="auth-submit" disabled={authLoading}>
              {authLoading ? "Please wait..." : authMode === "signup" ? "Create account" : "Log in"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <LogoMark />
          <div>
            <p className="brand-kicker">AI conversation studio</p>
            <h1 className="brand-title">NovaScribe</h1>
          </div>
        </div>

        <div className="profile-card">
          <div>
            <p className="profile-name">{currentUser.name}</p>
            <p className="profile-email">{currentUser.email}</p>
          </div>
          <button type="button" className="logout-button" onClick={handleLogout}>
            Logout
          </button>
        </div>

        <button type="button" className="primary-action" onClick={handleNewChat}>
          <span className="action-icon">+</span>
          <span>New chat</span>
        </button>

        <label className="search-box">
          <span className="search-icon">⌕</span>
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search chats"
          />
        </label>

        <div className="history-panel">
          <div className="panel-heading">
            <span>Chat history</span>
            <span>{chats.length}</span>
          </div>

          <div className="history-list">
            {chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className={`history-item ${chat.id === activeChatId ? "is-active" : ""}`}
                onClick={() => handleSelectChat(chat.id)}
              >
                <span className="history-title">{chat.title}</span>
                <span className="history-date">{formatTime(chat.updated_at)}</span>
              </button>
            ))}

            {!chats.length ? (
              <div className="history-empty">No saved chats yet.</div>
            ) : null}
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="workspace-kicker">Intelligent chat workspace</p>
            <h2 className="workspace-title">{activeChat?.title || "NovaScribe"}</h2>
          </div>

          <div className="workspace-controls">
            <div className={`status-pill ${isStreaming ? "is-live" : ""}`}>
              {isBooting ? "Loading..." : statusText}
            </div>
            <label className="model-picker">
              <span>Model</span>
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                disabled={isStreaming}
              >
                {MODEL_OPTIONS.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <section className="conversation-panel">
          <div className="message-list">
            {!messages.length ? (
              <div className="empty-state">
                <LogoMark />
                <h3>Start a new conversation</h3>
                <p>Ask anything, search previous chats, and keep your history stored in MongoDB.</p>
              </div>
            ) : null}

            {messages.map((msg, index) => {
              const isUser = msg.role === "user";
              return (
                <article
                  key={msg.id || `${msg.role}-${index}`}
                  className={`message-card ${isUser ? "from-user" : "from-assistant"}`}
                >
                  <p className="message-role">{isUser ? "You" : "NovaScribe"}</p>
                  <p className="message-content">{msg.content || "..."}</p>
                </article>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <div className="composer-panel">
            {errorText ? <p className="error-banner">{errorText}</p> : null}

            <div className="composer-row">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onInputKeyDown}
                rows={3}
                placeholder="Message NovaScribe"
                disabled={isStreaming}
                className="composer-input"
              />

              <div className="composer-actions">
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={isStreaming || !input.trim()}
                  className="send-button"
                >
                  Send
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={!isStreaming}
                  className="stop-button"
                >
                  Stop
                </button>
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
