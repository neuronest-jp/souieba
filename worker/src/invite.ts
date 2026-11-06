// 招待コードの対応表（ADR-0007 の 2026-11-06 追記）。secret `INVITE_CODE` の値は `コード=メール[,コード=メール…]`。
// 1 人 1 つのコードにして、コードからメール（= user_id）を固定する。コードを知っていても他人のメールでは入れない。
import { EMAIL_RE, normalizeEmail } from "./auth";
import { timingSafeEqual } from "./jwt";

export type InviteConfig =
  | { kind: "any"; code: string } // `=` を含まない値。development だけ「どのメールでも可」
  | { kind: "table"; entries: { code: string; email: string }[] }
  | { kind: "invalid"; reason: string }; // 理由はログにだけ出す（値そのものは含めない）

export function parseInviteConfig(raw: string | undefined, isDev: boolean): InviteConfig {
  const value = (raw ?? "").trim();
  if (!value) return { kind: "invalid", reason: "empty" };
  if (!value.includes("=")) {
    return isDev ? { kind: "any", code: value } : { kind: "invalid", reason: "not_a_table" };
  }
  const entries: { code: string; email: string }[] = [];
  const seen = new Set<string>();
  const parts = value.split(",");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!.trim();
    const eq = part.indexOf("=");
    if (eq < 0) return { kind: "invalid", reason: `entry_${i + 1}_no_equals` };
    const code = part.slice(0, eq).trim();
    const email = normalizeEmail(part.slice(eq + 1));
    if (!code) return { kind: "invalid", reason: `entry_${i + 1}_empty_code` };
    if (email.length > 254 || !EMAIL_RE.test(email)) return { kind: "invalid", reason: `entry_${i + 1}_bad_email` };
    if (seen.has(code)) return { kind: "invalid", reason: `entry_${i + 1}_duplicate_code` };
    seen.add(code);
    entries.push({ code, email });
  }
  return { kind: "table", entries };
}

// 一致したときだけ sub にするメールを返す。email は normalizeEmail 済みで渡す。
// すべての行と比べ、途中で抜けない（どの行で一致したか、何行あるかを時間で漏らしにくくする）。
export function matchInvite(cfg: Exclude<InviteConfig, { kind: "invalid" }>, code: string, email: string): string | null {
  if (cfg.kind === "any") return timingSafeEqual(code, cfg.code) ? email : null;
  let hit: string | null = null;
  for (const e of cfg.entries) {
    const c = timingSafeEqual(code, e.code) ? 1 : 0;
    const m = timingSafeEqual(email, e.email) ? 1 : 0;
    if ((c & m) === 1) hit = e.email;
  }
  return hit;
}
