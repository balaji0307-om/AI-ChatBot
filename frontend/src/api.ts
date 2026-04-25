import type { AuthResponse, ChatDetail, ChatSummary, HealthResponse, User } from "./types";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type RequestOptions = RequestInit & {
  sessionToken?: string | null;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  if (options.sessionToken) {
    headers.set("X-Session-Token", options.sessionToken);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
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

  return response.json() as Promise<T>;
}

export const api = {
  signup(payload: { name: string; email: string; password: string }) {
    return request<AuthResponse>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  login(payload: { email: string; password: string }) {
    return request<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  logout(sessionToken: string) {
    return request<{ ok: boolean }>("/api/auth/logout", {
      method: "POST",
      sessionToken
    });
  },
  me(sessionToken: string) {
    return request<{ user: User }>("/api/auth/me", {
      sessionToken
    });
  },
  health() {
    return request<HealthResponse>("/api/health");
  },
  listChats(sessionToken: string, q = "") {
    return request<{ items: ChatSummary[] }>(
      `/api/chats${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`,
      { sessionToken }
    );
  },
  createChat(sessionToken: string, title = "New chat") {
    return request<ChatDetail>("/api/chats", {
      method: "POST",
      sessionToken,
      body: JSON.stringify({ title })
    });
  },
  getChat(sessionToken: string, chatId: string) {
    return request<ChatDetail>(`/api/chats/${chatId}`, { sessionToken });
  }
};

export { API_BASE };
