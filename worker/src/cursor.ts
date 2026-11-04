// 一覧のキーセットカーソル。(COALESCE(happened_on,''), created_at, id) を base64url の JSON にする。
import { ApiError } from "./errors";

export type Cursor = { h: string; c: string; i: string };

const enc = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const dec = (s: string): string => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export const encodeCursor = (c: Cursor): string => enc(JSON.stringify(c));

export const decodeCursor = (raw: string | undefined | null): Cursor | null => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new ApiError(400, "validation", "カーソルが不正です");
  let parsed: unknown;
  try {
    parsed = JSON.parse(dec(raw));
  } catch {
    throw new ApiError(400, "validation", "カーソルが不正です");
  }
  if (typeof parsed !== "object" || parsed === null) throw new ApiError(400, "validation", "カーソルが不正です");
  const o = parsed as Record<string, unknown>;
  if (typeof o.h !== "string" || typeof o.c !== "string" || typeof o.i !== "string") {
    throw new ApiError(400, "validation", "カーソルが不正です");
  }
  return { h: o.h, c: o.c, i: o.i };
};
