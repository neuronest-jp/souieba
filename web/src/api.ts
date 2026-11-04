// Worker の API を呼ぶ薄いクライアント。エラーは { error: { code, message } } の形で返ってくる。
import type { Memory, MemoryDetail, MemoryList, NewMemory } from "./api/types";

export type ApiErrorBody = { error: { code: string; message: string } };

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Health = { ok: boolean; service: string; version: string; time: string };
export type Me = { user_id: string; display_name: string | null; since: string };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { accept: "application/json", ...(init.headers ?? {}) },
    credentials: "same-origin",
  });
  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      /* 本文なし */
    }
    throw new ApiError(res.status, body?.error?.code ?? "http_error", body?.error?.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  // Access のセッション切れでログイン画面の HTML が返ることがある。JSON でなければログイン扱い。
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new ApiError(401, "not_json", "ログインが必要です");
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  health: () => request<Health>("/api/health"),
  me: () => request<Me>("/api/me"),
  createMemory: (input: NewMemory) => request<Memory>("/api/memories", json("POST", input)),
  listMemories: (cursor?: string | null) =>
    request<MemoryList>(`/api/memories${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  getMemory: (id: string) => request<MemoryDetail>(`/api/memories/${encodeURIComponent(id)}`),
  deleteMemory: (id: string) => request<void>(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
