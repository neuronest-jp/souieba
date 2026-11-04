// PreToolUse フック: .dev.vars と demo/photos/ への書き込みを禁止する。
// 標準入力の JSON（tool_name, tool_input）を見て、該当すれば exit 2 で拒否する。
// 依存なし（Node 標準のみ）。
//
// 方針:
// - Write / Edit / MultiEdit / NotebookEdit は対象ファイルのパスで判定する
// - Bash はコマンドを区間（&&, ||, ;, |）に分け、禁止パスを含む区間が
//   「読むだけのコマンド」（cat, ls, head ...）でなければ拒否する。
//   node -e や python -c のような書き込みも、読み取り専用でない以上は拒否される
// - ヒアドキュメントの本文は文章なので判定から外す。ただし本文をシェルや
//   インタプリタに流す場合（bash <<EOF など）は本文も判定する
import { readFileSync } from "node:fs";

const FORBIDDEN = [
  // .dev.vars と .dev.vars.<env> は禁止。テンプレートの .dev.vars.example だけ許す。
  { pattern: /\.dev\.vars(?!\.example\b)/, label: ".dev.vars" },
  { pattern: /demo\/photos(\/|$|[\s"'`])/, label: "demo/photos/" },
];

// 区間の先頭コマンドがこれだけなら「読むだけ」とみなす。
const READ_ONLY_COMMANDS = new Set([
  "cat", "ls", "head", "tail", "less", "more", "grep", "rg", "wc", "stat", "file", "diff",
  "test", "[", "echo", "printf", "md5sum", "sha256sum", "du", "find", "realpath", "basename", "dirname",
]);

// ヒアドキュメント本文を取り除く。本文を実行系（sh / node / python など）に流すものは本文を残す。
const INTERPRETER_RE = /(^|[\s;&|(])(sh|bash|zsh|dash|node|python3?|perl|ruby|deno|bun)(\s|$)/;
const stripHeredocBodies = (cmd) =>
  cmd.replace(/([^\n]*)<<-?\s*(['"]?)(\w+)\2([^\n]*)\n([\s\S]*?)\n[ \t]*\3(?=\n|$)/g, (m, before, q, tag, rest, body) => {
    const line = `${before} ${rest}`;
    if (INTERPRETER_RE.test(line)) return m; // 本文がコードとして実行される
    return `${before}<<${tag}${rest}\n${tag}`;
  });

// コマンドを区間に分ける（引用の中の区切りは厳密に扱わない。安全側に倒れる）。
const splitSegments = (cmd) => cmd.split(/\s*(?:&&|\|\||;|\||\n)\s*/).filter((s) => s.length > 0);

// 区間の先頭コマンド名（環境変数代入や sudo、サブシェルの括弧は読み飛ばす）。
const headCommand = (segment) => {
  const tokens = segment
    .replace(/^[\s(]+/, "")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) && t !== "sudo" && t !== "command");
  return tokens[0] ?? "";
};

const isReadOnlySegment = (segment) => {
  if (/>|\btee\b/.test(segment)) return false; // リダイレクトや tee があれば書き込み
  return READ_ONLY_COMMANDS.has(headCommand(segment));
};

let input = "";
try {
  input = readFileSync(0, "utf8");
} catch {
  process.exit(0);
}
let payload;
try {
  payload = JSON.parse(input);
} catch {
  process.exit(0);
}

const deny = (label) => {
  process.stderr.write(
    `拒否: ${label} への書き込みは禁止されています（.claude/settings.json のフック）。` +
      ` 秘密情報は wrangler secret、写真は開発者が手で置きます。\n`,
  );
  process.exit(2);
};

const tool = payload.tool_name ?? "";
const ti = payload.tool_input ?? {};

if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
  const path = typeof ti.file_path === "string" ? ti.file_path : typeof ti.notebook_path === "string" ? ti.notebook_path : "";
  for (const f of FORBIDDEN) if (f.pattern.test(path)) deny(f.label);
} else if (tool === "Bash" && typeof ti.command === "string") {
  const cmd = stripHeredocBodies(ti.command);
  for (const segment of splitSegments(cmd)) {
    for (const f of FORBIDDEN) {
      if (!f.pattern.test(segment)) continue;
      if (isReadOnlySegment(segment)) continue;
      deny(f.label);
    }
  }
}
process.exit(0);
