// ことばの地図の置き場（ADR-0014）。R2（写真と同じバケット）の maps/<user>/keywords.json に、Claude が選んだ言葉の一覧だけを置く。
// 置くのは label・kind・surfaces と、作った時刻・そのときの記憶の件数だけ（本文・引用・数は置かない。見るたびに D1 から数え直す）。
// GET /api/photos/* は photos/<user>/ の下しか返さないので、ここは画面から直接は読めない
import { KEYWORD_KINDS } from "../ai/schemas";
import { surfacesStillWritten } from "../db/keywords";
import type { StoredKeyword } from "./count";

export const mapKey = (userId: string) => `maps/${userId}/keywords.json`;

export type StoredMap = { version: 1; generated_at: string; memory_count: number; keywords: StoredKeyword[] };

const KINDS = new Set<string>(KEYWORD_KINDS);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** 形の崩れたもの・知らない版は無かったものとして扱う（地図はまた集めなおせる） */
export const parseStoredMap = (x: unknown): StoredMap | null => {
  if (!isObj(x) || x.version !== 1 || typeof x.generated_at !== "string" || typeof x.memory_count !== "number" || !Array.isArray(x.keywords)) return null;
  const keywords: StoredKeyword[] = [];
  for (const k of x.keywords as unknown[]) {
    if (!isObj(k) || typeof k.label !== "string" || typeof k.kind !== "string" || !KINDS.has(k.kind) || !Array.isArray(k.surfaces)) continue;
    const surfaces = (k.surfaces as unknown[]).filter((s): s is string => typeof s === "string" && s.length > 0);
    if (surfaces.length > 0) keywords.push({ label: k.label, kind: k.kind as StoredKeyword["kind"], surfaces });
  }
  return { version: 1, generated_at: x.generated_at, memory_count: x.memory_count, keywords };
};

export async function readStoredMap(bucket: R2Bucket, userId: string): Promise<StoredMap | null> {
  const obj = await bucket.get(mapKey(userId));
  if (!obj) return null;
  try {
    return parseStoredMap(JSON.parse(new TextDecoder().decode(await obj.arrayBuffer())));
  } catch {
    return null;
  }
}

export async function writeStoredMap(bucket: R2Bucket, userId: string, map: StoredMap): Promise<void> {
  await bucket.put(mapKey(userId), new TextEncoder().encode(JSON.stringify(map)), { httpMetadata: { contentType: "application/json" } });
}

/**
 * 記憶を消したとき、その本文にだけ出てきた形を置き場から外す（原則 5「削除は即時」。DELETE /api/memories/:id のあと）。
 * 地図は見るたびに数え直すので画面には出ないが、置き場に消した本文の断片（label・surfaces）を残さない。
 * 調べるのは消した本文に出てくる形だけ。残っている本文のどれにも出てこない形を外し、形が 1 つも残らない言葉は外す。
 * label が残った形のどれにも含まれなくなったら、残った最初の形に替える（verifyKeywords と同じ決め方）。変わらなければ書かない
 */
export async function forgetDeletedBody(env: { DB: D1Database; PHOTOS: R2Bucket }, userId: string, body: string): Promise<void> {
  const stored = await readStoredMap(env.PHOTOS, userId);
  if (!stored) return;
  const candidates = [...new Set(stored.keywords.flatMap((k) => k.surfaces))].filter((s) => body.includes(s));
  if (candidates.length === 0) return;
  const alive = await surfacesStillWritten(env.DB, userId, candidates);
  const gone = new Set(candidates.filter((s) => !alive.has(s)));
  if (gone.size === 0) return;
  const keywords = stored.keywords.flatMap((k) => {
    const surfaces = k.surfaces.filter((s) => !gone.has(s));
    if (surfaces.length === 0) return [];
    const label = surfaces.some((s) => s.includes(k.label)) ? k.label : surfaces[0]!;
    return [{ label, kind: k.kind, surfaces }];
  });
  await writeStoredMap(env.PHOTOS, userId, { ...stored, keywords });
}
