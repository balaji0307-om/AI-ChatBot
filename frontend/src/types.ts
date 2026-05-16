export type ChatRole = "user" | "assistant" | "system";

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
}

export interface AuthResponse {
  user: User;
  session_token: string;
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
}

export interface ChatMessage {
  id?: string;
  role: ChatRole;
  content: string;
}

export interface ChatSummary {
  id: string;
  owner_id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
}

export interface ChatDetail extends ChatSummary {
  messages: ChatMessage[];
}

export interface HealthResponse {
  status: string;
  provider: string;
  product_name: string;
  model: string;
  has_api_key: boolean;
  api_key_suffix: string;
  api_key_count: number;
  mongodb_connected: boolean;
  redis_connected: boolean;
  rag_enabled: boolean;
  rate_limit_per_minute: number;
}
