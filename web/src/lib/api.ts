const BASE = "/api/v1";

function getToken(): string | null {
  return localStorage.getItem("token");
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${url}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || res.statusText);
  }
  return res.json();
}

// Auth
export interface AuthResponse {
  accessToken: string;
  user: { id: string; email: string; name: string; tenantId: string };
}

export const authApi = {
  login: (email: string, password: string) =>
    request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (data: { email: string; password: string; name: string; tenantId: string }) =>
    request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// Conversations
export interface Conversation {
  id: string;
  title: string;
  workflowId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
}

export const chatApi = {
  getConversations: () => request<Conversation[]>("/chat/conversations"),
  createConversation: (title?: string, workflowId?: string) =>
    request<Conversation>("/chat/conversations", {
      method: "POST",
      body: JSON.stringify({ title, workflowId }),
    }),
  getMessages: (id: string) => request<Message[]>(`/chat/conversations/${id}/messages`),
  deleteConversation: (id: string) =>
    request<{ success: boolean }>(`/chat/conversations/${id}`, { method: "DELETE" }),
};

// SSE chat stream
export function streamChat(
  body: {
    message: string;
    conversationId?: string;
    workflowId?: string;
    llmOptions?: { provider?: string; model?: string; temperature?: number };
  },
  onEvent: (event: string, data: Record<string, unknown>) => void,
  onDone: () => void,
  onError: (err: Error) => void,
): AbortController {
  const controller = new AbortController();
  const token = getToken();

  fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No readable stream");

      const decoder = new TextDecoder();
      let buffer = "";

      function read(): Promise<void> {
        return reader!.read().then(({ done, value }) => {
          if (done) {
            onDone();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              const raw = line.slice(6).trim();
              if (raw === "[DONE]") {
                onDone();
                return;
              }
              const parsed = JSON.parse(raw);
              onEvent(currentEvent || parsed.type, parsed);
            }
          }
          return read();
        });
      }
      return read();
    })
    .catch((err) => {
      if (err.name !== "AbortError") onError(err);
    });

  return controller;
}

// Workflows
export interface WorkflowNode {
  id: string;
  type: "start" | "end" | "agent" | "tool" | "condition";
  name: string;
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  source: string;
  target: string;
  condition?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: string;
  updatedAt: string;
}

export const workflowApi = {
  list: () => request<Workflow[]>("/workflows"),
  get: (id: string) => request<Workflow>(`/workflows/${id}`),
  create: (data: { name: string; description?: string; nodes: WorkflowNode[]; edges: WorkflowEdge[] }) =>
    request<Workflow>("/workflows", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Workflow>) =>
    request<Workflow>(`/workflows/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) => request<{ success: boolean }>(`/workflows/${id}`, { method: "DELETE" }),
};

// Knowledge bases
export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

export const kbApi = {
  list: () => request<KnowledgeBase[]>("/knowledge-bases"),
  create: (data: { name: string; description?: string; chunkSize?: number; chunkOverlap?: number }) =>
    request<KnowledgeBase>("/knowledge-bases", { method: "POST", body: JSON.stringify(data) }),
  addDocuments: (id: string, documents: { content: string; metadata?: Record<string, unknown> }[]) =>
    request<{ chunksCreated: number }>(`/knowledge-bases/${id}/documents`, {
      method: "POST",
      body: JSON.stringify({ documents }),
    }),
  search: (id: string, query: string, topK?: number) =>
    request<{ text: string; metadata: Record<string, unknown>; score: number }[]>(
      `/knowledge-bases/${id}/search`,
      { method: "POST", body: JSON.stringify({ query, topK }) },
    ),
  delete: (id: string) => request<{ success: boolean }>(`/knowledge-bases/${id}`, { method: "DELETE" }),
};
