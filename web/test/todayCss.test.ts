// S1 きょうの CSS（styles/today.css）の約束を見張る（見直し 3 回目）。
// - today.css に書いた独自の class 名が Tailwind の utility と重ならない（重なると utility の宣言も一緒に当たる。
//   手書きの ✓ の 2 画を「stroke-」に数字を続けた名前にしていたので stroke-width の utility になり、svg の stroke-width="1.8" を打ち消していた。
//   Tailwind はこのファイルの文字も拾うので、ここにもその名前をそのまま書かない）
// - 「あの日のひとこと」の現れる動きは終わりの形を持たない（持つと .press:active の沈みを打ち消す。.note.appear と同じ）
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const todayCss = stripComments(read("styles/today.css"));

// テンプレートの class に書いた名前（静的な class="…" と、:class の中の '…' の文字列）
const classTokens = (vue: string): string[] => {
  const out = new Set<string>();
  for (const m of vue.matchAll(/(:?)class="([^"]*)"/g)) {
    const parts = m[1] ? [...(m[2] ?? "").matchAll(/'([^']*)'/g)].map((s) => s[1] ?? "") : [m[2] ?? ""];
    for (const p of parts) for (const t of p.split(/\s+/)) if (t) out.add(t);
  }
  return [...out];
};

// @media の中を除いた規則と、prefers-reduced-motion: reduce の中の規則（入れ子は 1 段だけ見る）
const reduceBlock = (css: string): string => {
  const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
  if (at < 0) return "";
  let depth = 0;
  const open = css.indexOf("{", at);
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  return "";
};
const rules = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: (m[1] ?? "").split(",").map((s) => s.trim()),
    body: m[2] ?? "",
  }));

describe("today.css の独自の class 名は Tailwind の utility と重ならない", () => {
  const vueFiles = [
    ...readdirSync(join(SRC, "components/today"))
      .filter((f) => f.endsWith(".vue"))
      .map((f) => `components/today/${f}`),
    "screens/TodayScreen.vue",
  ];
  // today.css のセレクタに出てくる名前だけを見る（text-ink-soft などの utility はそのまま使ってよい）
  const own = [...new Set(vueFiles.flatMap((f) => classTokens(read(f))))].filter((t) =>
    new RegExp(`\\.${t.replace(/[^\w-]/g, "\\$&")}(?![\\w-])`).test(todayCss),
  );

  it("見張る名前が拾えている（手書きの ✓ の 2 画を含む）", () => {
    expect(own).toEqual(expect.arrayContaining(["saved-check", "is-drawing", "that-day", "waiting-thread"]));
    const check = classTokens(read("components/today/SavedCheck.vue"));
    // 2 画はそれぞれ別の名前で、today.css が描く動きを当てている
    const strokes = check.filter((t) => t !== "saved-check" && t !== "is-drawing" && t !== "shrink-0");
    expect(strokes).toHaveLength(2);
    for (const s of strokes) expect(own).toContain(s);
  });

  it("どれを Tailwind にかけても規則が作られない", async () => {
    const tw = await compile("@tailwind utilities;");
    const css = stripComments(tw.build(own)).trim();
    expect(css).toBe("");
  });
});

describe("あの日のひとこと（ThatDayLetter）の現れる動き", () => {
  it("ThatDayLetter は .that-day .press に .appear を付ける", () => {
    const vue = read("components/today/ThatDayLetter.vue");
    expect(classTokens(vue)).toEqual(expect.arrayContaining(["that-day", "press", "appear"]));
  });

  it("終わりの形を持たない（backwards）。both / forwards で終わりの transform を残すと、押しても沈まない", () => {
    const body = todayCss.slice(0, todayCss.indexOf("@media (prefers-reduced-motion: reduce)"));
    const own = rules(body).filter((r) => r.selectors.includes(".that-day.appear"));
    expect(own).toHaveLength(1);
    expect(own[0]!.body).toMatch(/animation-fill-mode:\s*backwards\s*;/);
    expect(own[0]!.body).not.toMatch(/\b(both|forwards)\b/);
  });

  it("動きを減らす設定では止める（today.css の reduce の一覧に入っている）", () => {
    const stop = rules(reduceBlock(todayCss)).filter((r) => r.selectors.includes(".that-day.appear"));
    expect(stop).toHaveLength(1);
    expect(stop[0]!.body).toMatch(/animation:\s*none\s*;/);
  });
});
