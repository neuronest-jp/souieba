// C3 写真からの気づき候補の実行（requirements F7、tasks T-1107-06、ADR-0012）。
// PUT /api/memories/:id/photo の 200 の前に ai_runs(kind='photo', running) を作り、waitUntil で 1 回だけ Claude を呼ぶ。
// 候補は本文の候補（facts.ts）と同じ memory_facts に source='ai'・status='candidate'・evidence='photo:<photo_key>' で入れる。
import { finishAiRun, hasAiRun, startAiRun } from "../db/ai_runs";
import { insertCandidateFacts, listPhotoFactKeys } from "../db/facts";
import type { MemoryRow } from "../db/memories";
import type { Env } from "../env";
import { type AiCaller, callClaude, type Effort } from "./client";
import { PHOTO_SYSTEM, photoUserMessage } from "./prompts";
import { PHOTO_HINTS_SCHEMA } from "./schemas";
import { verifyPhotoHints } from "./verify";

// Claude へ送る写真の上限（6 MiB。base64 にすると 8 MiB で、API の画像 1 枚 10MB に収まる）。Worker は縮小しない（requirements F7 送信上限）
export const PHOTO_HINT_MAX_BYTES = 6_291_456;

// 写真候補の根拠。本文の引用の代わりに、どの写真から出た候補かを残す（requirements 第8節 #4）
export const PHOTO_EVIDENCE_PREFIX = "photo:";
export const photoEvidence = (photoKey: string) => `${PHOTO_EVIDENCE_PREFIX}${photoKey}`;

export type PhotoDeps = { call?: AiCaller; now?: () => Date; effort?: Effort };
export type PhotoInfo = { key: string; contentType: "image/jpeg" | "image/png"; size: number };

// 同期部分: 上限内で、この記憶に photo の記録がまだ無いときだけ running を作る（N-5。写真を差し替えても 2 回目は走らせず、前の候補が残る）。
// 上限を超える写真では作らない（F7-6）。作らなかったら null
export async function beginPhoto(env: Env, userId: string, memoryId: string, photo: PhotoInfo, deps: PhotoDeps = {}): Promise<string | null> {
  if (photo.size > PHOTO_HINT_MAX_BYTES) return null;
  if (await hasAiRun(env.DB, memoryId, "photo")) return null;
  const now = (deps.now ? deps.now() : new Date()).toISOString();
  return startAiRun(env.DB, { userId, memoryId, kind: "photo", model: env.ANTHROPIC_MODEL, now });
}

// btoa は文字列しか受けないので、32KB ずつ文字に直してからまとめる（6 MiB を一度に引数へ広げると呼び出しの段が溢れる）
export const toBase64 = (bytes: Uint8Array): string => {
  const CHUNK = 0x8000;
  let s = "";
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
};

// 非同期部分: R2 から写真を読み、Claude を呼び、検証して保存する（waitUntil の中）。例外は握って failed にする。
// 失敗しても候補は増えず、画面は静か（F7 エラー時）
export async function runPhoto(env: Env, runId: string, memory: Pick<MemoryRow, "id" | "body">, photo: PhotoInfo, deps: PhotoDeps = {}): Promise<void> {
  const call = deps.call ?? callClaude;
  const nowIso = () => (deps.now ? deps.now() : new Date()).toISOString();
  try {
    const obj = await env.PHOTOS.get(photo.key);
    if (!obj) {
      // 走り出す前に差し替えられた・消された
      await finishAiRun(env.DB, runId, { status: "failed", error: "photo_missing", now: nowIso() });
      return;
    }
    const bytes = new Uint8Array(await obj.arrayBuffer());
    if (bytes.byteLength > PHOTO_HINT_MAX_BYTES) {
      await finishAiRun(env.DB, runId, { status: "failed", error: "photo_too_large", now: nowIso() });
      return;
    }
    const res = await call(env, {
      system: PHOTO_SYSTEM,
      user: photoUserMessage(memory),
      schema: PHOTO_HINTS_SCHEMA as unknown as Record<string, unknown>,
      effort: deps.effort ?? "low",
      image: { media_type: photo.contentType, data: toBase64(bytes) },
    });
    if (!res.ok) {
      await finishAiRun(env.DB, runId, { status: "failed", error: res.error, input_tokens: res.input_tokens, output_tokens: res.output_tokens, model: res.model, now: nowIso() });
      return;
    }
    const { items, stats } = verifyPhotoHints(res.json);
    if (stats.dropped.length) console.log("photo dropped", memory.id, JSON.stringify(stats.dropped.map((d) => d.reason)));
    // 同じ記憶に同じ写真候補が既にあれば足さない（本文の候補とは比べない。F7-7）
    const existing = await listPhotoFactKeys(env.DB, memory.id);
    const fresh = items.filter((h) => !existing.has(`${h.kind}\u0000${h.value}`));
    if (fresh.length === 0) {
      await finishAiRun(env.DB, runId, { status: "empty", input_tokens: res.input_tokens, output_tokens: res.output_tokens, model: res.model, now: nowIso() });
      return;
    }
    const evidence = photoEvidence(photo.key);
    await insertCandidateFacts(env.DB, memory.id, fresh.map((h) => ({ kind: h.kind, value: h.value, evidence })), nowIso());
    await finishAiRun(env.DB, runId, { status: "succeeded", input_tokens: res.input_tokens, output_tokens: res.output_tokens, model: res.model, now: nowIso() });
  } catch (e) {
    // 記憶が先に削除された場合の外部キー失敗なども、ここで握って failed にする
    console.error("runPhoto failed", memory.id, e);
    try {
      await finishAiRun(env.DB, runId, { status: "failed", error: e instanceof Error ? e.message : String(e), now: nowIso() });
    } catch {
      /* ai_runs 自体が消えている等 */
    }
  }
}
