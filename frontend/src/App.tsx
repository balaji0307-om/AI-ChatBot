import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { useAppStore } from "./store";
import type { ChatMessage } from "./types";

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

function formatTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function renderInlineMarkdown(text: string) {
  const normalized = text.replace(/^\*\s+/, "");
  const parts = normalized.split(/(\*\*.*?\*\*)/g).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function renderMessageContent(content: string) {
  const blocks = content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block, blockIndex) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const listLines = lines.filter((line) => /^[-*]\s+/.test(line));

    if (listLines.length === lines.length) {
      return (
        <ul key={`list-${blockIndex}`} className="message-list-block">
          {lines.map((line, lineIndex) => (
            <li key={`item-${blockIndex}-${lineIndex}`}>{renderInlineMarkdown(line)}</li>
          ))}
        </ul>
      );
    }

    if (lines.length === 1) {
      return (
        <p key={`p-${blockIndex}`} className="message-paragraph">
          {renderInlineMarkdown(lines[0])}
        </p>
      );
    }

    return (
      <div key={`group-${blockIndex}`} className="message-group">
        {lines.map((line, lineIndex) => (
          <p key={`line-${blockIndex}-${lineIndex}`} className="message-paragraph">
            {renderInlineMarkdown(line)}
          </p>
        ))}
      </div>
    );
  });
}

export default function App() {
  const {
    currentUser,
    sessionToken,
    chats,
    activeChatId,
    messages,
    selectedModel,
    theme,
    searchTerm,
    isStreaming,
    isBooting,
    errorText,
    statusText,
    setAuth,
    clearAuth,
    setChats,
    setActiveChatId,
    setMessages,
    appendMessages,
    replaceAssistantMessage,
    setSelectedModel,
    setTheme,
    setSearchTerm,
    setIsStreaming,
    setIsBooting,
    setErrorText,
    setStatusText
  } = useAppStore();

  const [authMode, setAuthMode] = useState<"signup" | "login">("signup");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? null,
    [activeChatId, chats]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!currentUser || !sessionToken) {
      setIsBooting(false);
      return;
    }

    const token = sessionToken;
    let cancelled = false;
    async function bootstrap() {
      setIsBooting(true);
      try {
        const data = await api.listChats(token);
        if (cancelled) return;
        if (!data.items.length) {
          const created = await api.createChat(token);
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
          setErrorText(error instanceof Error ? error.message : "Failed to load chat history.");
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
  }, [currentUser, sessionToken, setActiveChatId, setChats, setErrorText, setIsBooting, setMessages, setSelectedModel]);

  useEffect(() => {
    if (!activeChatId || !sessionToken) return;
    const token = sessionToken;
    let cancelled = false;
    async function loadChat() {
      try {
        const chat = await api.getChat(token, activeChatId);
        if (cancelled) return;
        setMessages(chat.messages || []);
        setSelectedModel(chat.model || MODEL_OPTIONS[0]);
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : "Failed to load this chat.");
        }
      }
    }
    loadChat();
    return () => {
      cancelled = true;
    };
  }, [activeChatId, sessionToken, setErrorText, setMessages, setSelectedModel]);

  useEffect(() => {
    if (!sessionToken) return;
    const token = sessionToken;
    const timer = setTimeout(async () => {
      try {
        const data = await api.listChats(token, searchTerm);
        setChats(data.items || []);
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "Failed to search chats.");
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [searchTerm, sessionToken, setChats, setErrorText]);

  async function refreshChats(preferredId = activeChatId) {
    if (!sessionToken) return;
    const token = sessionToken;
    const data = await api.listChats(token, searchTerm);
    setChats(data.items || []);
    if (preferredId) {
      const exists = (data.items || []).some((chat) => chat.id === preferredId);
      if (!exists && data.items.length) {
        setActiveChatId(data.items[0].id);
      }
    }
  }

  async function handleAuthSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      const data =
        authMode === "signup"
          ? await api.signup(authForm)
          : await api.login({ email: authForm.email, password: authForm.password });
      setAuth({ user: data.user, sessionToken: data.session_token });
      setAuthForm({ name: "", email: "", password: "" });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    if (sessionToken) {
      try {
        await api.logout(sessionToken);
      } catch {
        // ignore logout cleanup failures
      }
    }
    clearAuth();
    setAuthMode("login");
    setInput("");
  }

  async function handleNewChat() {
    if (!sessionToken) return;
    try {
      setErrorText("");
      const created = await api.createChat(sessionToken);
      await refreshChats(created.id);
      setActiveChatId(created.id);
      setMessages([]);
      setInput("");
      setStatusText("Fresh conversation ready");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to create a new chat.");
    }
  }

  async function handleSelectChat(chatId: string) {
    if (isStreaming || chatId === activeChatId) return;
    setErrorText("");
    setActiveChatId(chatId);
  }

  async function streamChatResponse(
    chatId: string,
    payload: { content: string; model: string; temperature: number; simulate_stream: boolean },
    assistantId: string,
    signal: AbortSignal
  ) {
    const response = await fetch(`/api/chats/${chatId}/messages/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Token": sessionToken ?? ""
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
          const packet = JSON.parse(raw) as { type: string; value: string };
          if (packet.type === "chunk") {
            textSoFar += packet.value;
            replaceAssistantMessage(assistantId, textSoFar);
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
    if (!trimmed || isStreaming || !sessionToken) return;

    try {
      setErrorText("");
      setStatusText("Thinking...");

      let chatId = activeChatId;
      if (!chatId) {
        const created = await api.createChat(sessionToken);
        chatId = created.id;
        setActiveChatId(chatId);
        await refreshChats(chatId);
      }

      const userMessage: ChatMessage = { id: makeId(), role: "user", content: trimmed };
      const assistantId = makeId();
      const assistantMessage: ChatMessage = { id: assistantId, role: "assistant", content: "" };

      appendMessages([userMessage, assistantMessage]);
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

      const refreshedChat = await api.getChat(sessionToken, chatId);
      setMessages(refreshedChat.messages || []);
      await refreshChats(chatId);
      setStatusText("Response complete");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setErrorText(error instanceof Error ? error.message : "Failed to get a response.");
      }
      setMessages(
        messages.map((msg) =>
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

  function onInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
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
                  onChange={(event) => setAuthForm((prev) => ({ ...prev, name: event.target.value }))}
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
                onChange={(event) => setAuthForm((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="Enter your email"
                required
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={authForm.password}
                onChange={(event) => setAuthForm((prev) => ({ ...prev, password: event.target.value }))}
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

        <button type="button" className="primary-action" onClick={() => void handleNewChat()}>
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
                onClick={() => void handleSelectChat(chat.id)}
              >
                <span className="history-title">{chat.title}</span>
                <span className="history-date">{formatTime(chat.updated_at)}</span>
              </button>
            ))}

            {!chats.length ? <div className="history-empty">No saved chats yet.</div> : null}
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
            <label className="model-picker">
              <span>Theme</span>
              <select
                value={theme}
                onChange={(event) => setTheme(event.target.value as "light" | "dark")}
              >
                <option value="light">Light mode</option>
                <option value="dark">Dark mode</option>
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
                  <div className="message-content">
                    {msg.content ? renderMessageContent(msg.content) : "..."}
                  </div>
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
                  onClick={() => void handleSend()}
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
