// 写真の取得（Bearer 付き）と blob URL の共有。参照数が 0 になったら revoke する。
import { API_BASE, ApiError } from "./api";
import { getTokenSync } from "./auth";

type Entry = { url: Promise<string>; refs: number; resolved?: string };
const cache = new Map<string, Entry>();

export async function fetchPhotoObjectUrl(key: string): Promise<string> {
  let e = cache.get(key);
  if (!e) {
    const url = (async () => {
      const headers = new Headers();
      const token = getTokenSync();
      if (token) headers.set("authorization", `Bearer ${token}`);
      const res = await fetch(`${API_BASE}/api/photos/${key}`, { headers });
      if (!res.ok) throw new ApiError(res.status, "photo", "写真を読めませんでした");
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      const entry = cache.get(key);
      if (entry) entry.resolved = u;
      return u;
    })();
    e = { url, refs: 0 };
    cache.set(key, e);
    url.catch(() => cache.delete(key));
  }
  e.refs += 1;
  return e.url;
}

export function releasePhotoObjectUrl(key: string): void {
  const e = cache.get(key);
  if (!e) return;
  e.refs -= 1;
  if (e.refs <= 0) {
    cache.delete(key);
    if (e.resolved) URL.revokeObjectURL(e.resolved);
  }
}
