// 画面の禁止語と色リテラルの検査（T-1108-04、requirements X-12 / N-11）。`pnpm check:words` または CI で実行する。
// - 禁止語「AI」「生成」「送信」: .vue の <template>（HTML コメントを除く）と、web/src の .ts / .vue <script> の文字列リテラル
//   （画面に出る文言だけを見る。識別子やコメントは対象外。「AI」は前後が英字でないときだけ）
// - 色リテラル `#rgb` / `#rrggbb`: .vue 全体。色は web/src/style.css の @theme トークンだけで指定する
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "web/src");

const WORD_RE = /(^|[^A-Za-z])AI(?![A-Za-z])|生成|送信/;
const COLOR_RE = /#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})(?![0-9A-Za-z_-])/;

const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
const stripJsComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre = "") => pre + m.slice(pre.length).replace(/[^\n]/g, " "));

// 文字列リテラル（'...' "..." `...`）だけを残し、他は空白にする（行番号を保つ）
const onlyStrings = (s) => {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const q = s[i];
    if (q === '"' || q === "'" || q === "`") {
      let j = i + 1;
      while (j < s.length && s[j] !== q) j += s[j] === "\\" ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j + 1;
    } else {
      out += q === "\n" ? "\n" : " ";
      i += 1;
    }
  }
  return out;
};

const block = (src, tag) => {
  const open = src.search(new RegExp(`<${tag}[\\s>]`));
  if (open < 0) return null;
  const close = tag === "template" ? src.lastIndexOf(`</${tag}>`) : src.indexOf(`</${tag}>`, open);
  if (close < 0) return null;
  // 開始位置までを改行だけに置き換えて行番号を合わせる
  return src.slice(0, open).replace(/[^\n]/g, "") + src.slice(open, close);
};

const scan = (text, re, file, kind) =>
  text.split("\n").flatMap((line, n) => (re.test(line) ? [{ file, line: n + 1, kind, text: line.trim() }] : []));

/** 1 ファイル分の違反を返す（純粋関数。self-test でも使う） */
export const findViolations = (file, src) => {
  const found = [];
  if (file.endsWith(".vue")) {
    const tpl = block(src, "template");
    if (tpl) found.push(...scan(stripHtmlComments(tpl), WORD_RE, file, "word"));
    const scr = block(src, "script");
    if (scr) found.push(...scan(onlyStrings(stripJsComments(scr)), WORD_RE, file, "word"));
    found.push(...scan(stripHtmlComments(src), COLOR_RE, file, "color"));
  } else if (file.endsWith(".ts")) {
    found.push(...scan(onlyStrings(stripJsComments(src)), WORD_RE, file, "word"));
  }
  return found;
};

// self-test（壊れた検査で CI が素通りしないように）
const cases = [
  [1, "a.vue", "<template><p>AI が考えました</p></template>"],
  [1, "a.vue", "<template><p>文章を生成しています</p></template>"],
  [1, "a.vue", "<template><p>送信する</p></template>"],
  [0, "a.vue", "<template><p>MAIN DETAIL</p><!-- AI 生成 --></template>"],
  [0, "a.vue", "<script setup lang=\"ts\">\n// AI の結果\nconst DETAIL_AI = 1;\n</script><template><p>残しました</p></template>"],
  [1, "a.vue", "<script setup lang=\"ts\">\nconst m = \"送信できませんでした\";\n</script><template><p>{{ m }}</p></template>"],
  [1, "a.vue", "<template><p style=\"color: #c9684a\">x</p></template>"],
  [1, "a.vue", "<template><p class=\"text-[#fff]\">x</p></template>"],
  [0, "a.vue", "<template><a href=\"#memory/1\">x</a><template #default>y</template></template>"],
  [1, "a.ts", "export const msg = 'AI に聞く';"],
  [0, "a.ts", "// AI を呼ばない\nconst AIRPORT = \"空港\";"],
];
let selfFail = 0;
for (const [want, file, src] of cases) {
  const got = findViolations(file, src).length > 0 ? 1 : 0;
  if (got !== want) {
    selfFail += 1;
    console.error(`self-test NG: want=${want} got=${got} ${JSON.stringify(src)}`);
  }
}
if (selfFail > 0) process.exit(1);

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = walk(SRC).filter((f) => (f.endsWith(".vue") || f.endsWith(".ts")) && !f.endsWith(".d.ts"));
  const all = files.flatMap((f) => findViolations(f, readFileSync(f, "utf8")));
  for (const v of all) {
    const what = v.kind === "word" ? "禁止語（AI / 生成 / 送信）" : "色リテラル（@theme のトークンを使う）";
    console.error(`${relative(ROOT, v.file)}:${v.line}: ${what}: ${v.text}`);
  }
  if (all.length > 0) {
    console.error(`NG: ${all.length} 件`);
    process.exit(1);
  }
  console.log(`check:words OK（${files.length} ファイル、self-test ${cases.length} 件）`);
}
