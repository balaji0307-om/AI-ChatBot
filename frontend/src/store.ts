import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatDetail, ChatSummary, User } from "./types";

interface AppState {
  currentUser: User | null;
  sessionToken: string | null;
  chats: ChatSummary[];
  activeChatId: string;
  messages: ChatDetail["messages"];
  selectedModel: string;
  theme: "light" | "dark";
  searchTerm: string;
  isStreaming: boolean;
  isBooting: boolean;
  errorText: string;
  statusText: string;
  setAuth: (payload: { user: User; sessionToken: string }) => void;
  clearAuth: () => void;
  setChats: (chats: ChatSummary[]) => void;
  setActiveChatId: (chatId: string) => void;
  setMessages: (messages: ChatDetail["messages"]) => void;
  appendMessages: (messages: ChatDetail["messages"]) => void;
  replaceAssistantMessage: (assistantId: string, content: string) => void;
  setSelectedModel: (model: string) => void;
  setTheme: (theme: "light" | "dark") => void;
  setSearchTerm: (value: string) => void;
  setIsStreaming: (value: boolean) => void;
  setIsBooting: (value: boolean) => void;
  setErrorText: (value: string) => void;
  setStatusText: (value: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      currentUser: null,
      sessionToken: null,
      chats: [],
      activeChatId: "",
      messages: [],
      selectedModel: "gemini-2.5-flash",
      theme: "light",
      searchTerm: "",
      isStreaming: false,
      isBooting: true,
      errorText: "",
      statusText: "Connected workspace",
      setAuth: ({ user, sessionToken }) =>
        set({ currentUser: user, sessionToken, errorText: "", statusText: "Connected workspace" }),
      clearAuth: () =>
        set({
          currentUser: null,
          sessionToken: null,
          chats: [],
          activeChatId: "",
          messages: [],
          searchTerm: "",
          errorText: "",
          statusText: "Connected workspace"
        }),
      setChats: (chats) => set({ chats }),
      setActiveChatId: (activeChatId) => set({ activeChatId }),
      setMessages: (messages) => set({ messages }),
      appendMessages: (newMessages) => set((state) => ({ messages: [...state.messages, ...newMessages] })),
      replaceAssistantMessage: (assistantId, content) =>
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === assistantId ? { ...msg, content } : msg
          )
        })),
      setSelectedModel: (selectedModel) => set({ selectedModel }),
      setTheme: (theme) => set({ theme }),
      setSearchTerm: (searchTerm) => set({ searchTerm }),
      setIsStreaming: (isStreaming) => set({ isStreaming }),
      setIsBooting: (isBooting) => set({ isBooting }),
      setErrorText: (errorText) => set({ errorText }),
      setStatusText: (statusText) => set({ statusText })
    }),
    {
      name: "nova-scribe-store",
      partialize: (state) => ({
        currentUser: state.currentUser,
        sessionToken: state.sessionToken,
        selectedModel: state.selectedModel,
        theme: state.theme
      })
    }
  )
);
