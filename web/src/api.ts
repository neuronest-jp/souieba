// Worker の API を呼ぶ薄いクライアント。エラーは { error: { code, message } } の形で返ってくる。
// ネイティブアプリでは VITE_API_BASE（https://<api-domain>）を叩き、Web の開発では同一オリジン（/api）。
import { clearToken, getTokenSync } from "./auth";
import type { ConnectionsResponse, Fact, Memory, MemoryDetail, MemoryList, NewMemory, Recall, TodayResponse } from "./api/types";

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") ?? "";

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
export type LoginResult = { token: string; expires_at: string; user_id: string };

const unauthorized = async () => {
  await clearToken();
  window.dispatchEvent(new Event("souieba:unauthorized"));
};

async function request<T>(path: string, init: RequestInit = {}, opts: { auth?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  headers.set("accept", "application/json");
  if (opts.auth !== false) {
    const token = getTokenSync();
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "network", "いま、うまくつながりません");
  }
  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      /* 本文なし */
    }
    if (res.status === 401 && opts.auth !== false) await unauthorized();
    throw new ApiError(res.status, body?.error?.code ?? "http_error", body?.error?.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new ApiError(res.status, "not_json", "うまくいきませんでした");
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  health: () => request<Health>("/api/health", {}, { auth: false }),
  login: (invite_code: string, email: string) => request<LoginResult>("/api/auth/login", json("POST", { invite_code, email }), { auth: false }),
  me: () => request<Me>("/api/me"),
  createMemory: (input: NewMemory) => request<Memory>("/api/memories", json("POST", input)),
  listMemories: (cursor?: string | null) =>
    request<MemoryList>(`/api/memories${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  getMemory: (id: string) => request<MemoryDetail>(`/api/memories/${encodeURIComponent(id)}`),
  deleteMemory: (id: string) => request<void>(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getFacts: (id: string) => request<{ pending: boolean; items: Fact[] }>(`/api/memories/${encodeURIComponent(id)}/facts`),
  getRecalls: (id: string) => request<{ pending: boolean; items: Recall[] }>(`/api/memories/${encodeURIComponent(id)}/recalls`),
  decideFact: (id: string, status: "confirmed" | "rejected") =>
    request<{ id: string; status: string; decided_at: string }>(`/api/facts/${encodeURIComponent(id)}`, json("PATCH", { status })),
  connections: () => request<ConnectionsResponse>("/api/connections"),
  today: () => request<TodayResponse>("/api/today"),
  recallFeedback: (id: string, feedback: "helpful" | "not_related" | "none") =>
    request<{ id: string; feedback: string }>(`/api/recalls/${encodeURIComponent(id)}`, json("PATCH", { feedback })),
  putPhoto: (id: string, photo: Blob) => {
    const form = new FormData();
    form.set("photo", photo, "photo.jpg");
    return request<{ photo_key: string; photo_content_type: string }>(`/api/memories/${encodeURIComponent(id)}/photo`, {
      method: "PUT",
      body: form,
    });
  },
};
