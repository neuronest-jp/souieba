// Claude の出力の検証（architecture 6.5、原則 3）。純粋関数。
// evidence は引用元 body の部分文字列でなければ捨てる。NFC 正規化・trim・全角半角変換はしない（X-7）。
import { countChars } from "../validate";
import type { FactsOutput, RecallOutput } from "./schemas";

export const RECALL_MAX = 3;
export const FACTS_MAX = 10;
export const REASON_MAX = 80;

export type VerifiedRecall = { related_memory_id: string; reason: string; evidence: string };
export type VerifiedFact = { kind: "person" | "place" | "date" | "thing"; value: string; evidence: string };

export type VerifyStats = { kept: number; dropped: Array<{ reason: string; item: unknown }> };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

const parseItems = (out: unknown): unknown[] | null => {
  if (!isObj(out) || !Array.isArray(out.items)) return null;
  return out.items;
};

// C1 想起。pastBodies: 送った過去記憶の id → body。selfId: 新しい記憶の id。
export function verifyRecall(out: unknown, pastBodies: Map<string, string>, selfId: string): { items: VerifiedRecall[]; stats: VerifyStats } {
  const stats: VerifyStats = { kept: 0, dropped: [] };
  const items = parseItems(out);
  if (!items) return { items: [], stats: { kept: 0, dropped: [{ reason: "malformed", item: out }] } };
  const seen = new Set<string>();
  const kept: VerifiedRecall[] = [];
  for (const raw of items) {
    if (kept.length >= RECALL_MAX) {
      stats.dropped.push({ reason: "over_max", item: raw });
      continue;
    }
    if (!isObj(raw) || typeof raw.related_memory_id !== "string" || typeof raw.reason !== "string" || typeof raw.evidence !== "string") {
      stats.dropped.push({ reason: "malformed", item: raw });
      continue;
    }
    const id = raw.related_memory_id;
    const body = pastBodies.get(id);
    if (body === undefined) {
      stats.dropped.push({ reason: "unknown_id", item: raw });
      continue;
    }
    if (id === selfId) {
      stats.dropped.push({ reason: "self", item: raw });
      continue;
    }
    if (seen.has(id)) {
      stats.dropped.push({ reason: "duplicate", item: raw });
      continue;
    }
    if (raw.evidence.length === 0 || !body.includes(raw.evidence)) {
      stats.dropped.push({ reason: "evidence_not_in_body", item: raw });
      continue;
    }
    const reasonLen = countChars(raw.reason);
    if (reasonLen === 0 || reasonLen > REASON_MAX) {
      stats.dropped.push({ reason: "reason_length", item: raw });
      continue;
    }
    seen.add(id);
    kept.push({ related_memory_id: id, reason: raw.reason, evidence: raw.evidence });
  }
  stats.kept = kept.length;
  return { items: kept, stats };
}

const KINDS = new Set(["person", "place", "date", "thing"]);

const isRealDate = (y: number, m: number, d: number): boolean => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

// date の value が YYYY-MM-DD / YYYY-MM / YYYY のいずれかで、実在する日付か。
export const isValidDateValue = (v: string): boolean => {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(v);
  if (!m) return false;
  const y = Number(m[1]);
  if (y < 1900 || y > 2100) return false;
  if (m[2]) {
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) return false;
    if (m[3] && !isRealDate(y, mo, Number(m[3]))) return false;
  }
  return true;
};

// C2 候補抽出。body: 新しい記憶の本文。
export function verifyFacts(out: unknown, body: string): { items: VerifiedFact[]; stats: VerifyStats } {
  const stats: VerifyStats = { kept: 0, dropped: [] };
  const items = parseItems(out);
  if (!items) return { items: [], stats: { kept: 0, dropped: [{ reason: "malformed", item: out }] } };
  const seen = new Set<string>();
  const kept: VerifiedFact[] = [];
  for (const raw of items) {
    if (kept.length >= FACTS_MAX) {
      stats.dropped.push({ reason: "over_max", item: raw });
      continue;
    }
    if (!isObj(raw) || typeof raw.kind !== "string" || typeof raw.value !== "string" || typeof raw.evidence !== "string") {
      stats.dropped.push({ reason: "malformed", item: raw });
      continue;
    }
    if (!KINDS.has(raw.kind)) {
      stats.dropped.push({ reason: "bad_kind", item: raw });
      continue;
    }
    if (raw.value.length === 0 || raw.evidence.length === 0) {
      stats.dropped.push({ reason: "empty", item: raw });
      continue;
    }
    if (!body.includes(raw.evidence)) {
      stats.dropped.push({ reason: "evidence_not_in_body", item: raw });
      continue;
    }
    if (raw.kind === "date" && !isValidDateValue(raw.value)) {
      stats.dropped.push({ reason: "bad_date", item: raw });
      continue;
    }
    const key = `${raw.kind}\u0000${raw.value}`;
    if (seen.has(key)) {
      stats.dropped.push({ reason: "duplicate", item: raw });
      continue;
    }
    seen.add(key);
    kept.push({ kind: raw.kind as VerifiedFact["kind"], value: raw.value, evidence: raw.evidence });
  }
  stats.kept = kept.length;
  return { items: kept, stats };
}
