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

// プロンプトでは本文の & < > " をエスケープして渡す（prompts.ts）。Claude が見たままを引用すると
// evidence にエスケープ済みの記号が混じるので、逆変換した形でも照合する。保存するのは元の記号の方。
export const unescapeXml = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// body に逐語で含まれる形の evidence を返す（無ければ null）。正規化や trim はしない（X-7）。
// C2 の date 以外の value の照合にも使う。
export const matchEvidence = (evidence: string, body: string): string | null => {
  if (evidence.length === 0) return null;
  if (body.includes(evidence)) return evidence;
  const un = unescapeXml(evidence);
  if (un !== evidence && un.length > 0 && body.includes(un)) return un;
  return null;
};

// reason は 80 文字で切り詰める（捨てない。requirements 第2節）。evidence は切らない。
export const clampReason = (reason: string): string => Array.from(reason).slice(0, REASON_MAX).join("");

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
    const evidence = matchEvidence(raw.evidence, body);
    if (evidence === null) {
      stats.dropped.push({ reason: "evidence_not_in_body", item: raw });
      continue;
    }
    if (countChars(raw.reason) === 0) {
      stats.dropped.push({ reason: "reason_length", item: raw });
      continue;
    }
    seen.add(id);
    kept.push({ related_memory_id: id, reason: clampReason(raw.reason), evidence });
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

// 年（4 桁）が本文に書かれているか。半角と全角の数字を見る（漢数字や和暦は見ない）。
// 前後に数字が続く並びは数えない。「12000円」の 2000、「20260円」の 2026 は年ではない。
// 「2000円」のような 4 桁だけの数字は年と見分けられないので、残る（requirements F4-10）
const yearInBody = (year: string, body: string): boolean => {
  const wide = year.replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0));
  // year は isValidDateValue を通った 4 桁の数字なので、そのまま正規表現に入れてよい
  const standsAlone = (y: string) => new RegExp(`(?<![0-9０-９])${y}(?![0-9０-９])`).test(body);
  return standsAlone(year) || standsAlone(wide);
};

// C2 候補抽出。body: 新しい記憶の本文。happenedOn: その記憶の起きた日（「いつだったか」なら null）。
// 省略すると null（起きた日が不明）として、年の根拠を本文に求める側に倒す。
export function verifyFacts(out: unknown, body: string, happenedOn: string | null = null): { items: VerifiedFact[]; stats: VerifyStats } {
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
    const evidence = matchEvidence(raw.evidence, body);
    if (evidence === null) {
      stats.dropped.push({ reason: "evidence_not_in_body", item: raw });
      continue;
    }
    // date 以外の value も本文の言葉そのままでなければ捨てる。「はると（息子）」「祖母」のような推測や言い換えが、
    // 引用を添えた候補として並ぶのを防ぐ（原則 1・3）。date は「先月」→ 2026-10 のように本文と違う形に直した値が正しいので、
    // 形と実在だけを見る。
    let value: string;
    if (raw.kind === "date") {
      if (!isValidDateValue(raw.value)) {
        stats.dropped.push({ reason: "bad_date", item: raw });
        continue;
      }
      // 起きた日が不明な記憶では、年の根拠は本文にしか無い。本文に無い年は当てはめた推測なので捨てる（原則 1）
      if (happenedOn === null && !yearInBody(raw.value.slice(0, 4), body)) {
        stats.dropped.push({ reason: "date_no_year", item: raw });
        continue;
      }
      value = raw.value;
    } else {
      const matched = matchEvidence(raw.value, body);
      if (matched === null) {
        stats.dropped.push({ reason: "value_not_in_body", item: raw });
        continue;
      }
      value = matched;
    }
    // 重複は保存する形（エスケープを戻した値）で見る。&quot; の有無で同じ候補が 2 つ残らないように
    const key = `${raw.kind}\u0000${value}`;
    if (seen.has(key)) {
      stats.dropped.push({ reason: "duplicate", item: raw });
      continue;
    }
    seen.add(key);
    kept.push({ kind: raw.kind as VerifiedFact["kind"], value, evidence });
  }
  stats.kept = kept.length;
  return { items: kept, stats };
}
