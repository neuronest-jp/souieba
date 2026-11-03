// Worker の API を呼ぶ薄いクライアント。エラーは { error: { code, message } } の形で返ってくる。
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

export type Health = { ok: boolean; service: string; version: string; environment: string; time: string };
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
  // Access のセッション切れでログイン画面の HTML が返ることがある。JSON でなければログイン扱い。
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new ApiError(401, "not_json", "ログインが必要です");
  return (await res.json()) as T;
}

export const api = {
  health: () => request<Health>("/api/health"),
  me: () => request<Me>("/api/me"),
};
