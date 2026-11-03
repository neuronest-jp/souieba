// PreToolUse フック: .dev.vars と demo/photos/ への書き込みを禁止する。
// 標準入力の JSON（tool_name, tool_input）を見て、該当すれば exit 2 で拒否する。
// 依存なし（Node 標準のみ）。
import { readFileSync } from "node:fs";

const FORBIDDEN = [
  // .dev.vars と .dev.vars.<env> は禁止。テンプレートの .dev.vars.example だけ許す。
  { pattern: /(^|[\/\s"'`=])\.dev\.vars(?!\.example\b)/, label: ".dev.vars" },
  { pattern: /(^|[\/\s"'`=])demo\/photos(\/|$|[\s"'`])/, label: "demo/photos/" },
];

// Bash で書き込みとみなす語。読むだけ（cat, ls, head）は許す。
const WRITE_WORDS =
  /(>>?|\btee\b|\bcp\b|\bmv\b|\brm\b|\btouch\b|\bsed\s+-i|\bperl\s+-i|\bdd\b|\bmkdir\b|\bchmod\b|\btruncate\b|\binstall\b|\bcurl\b.*-o|\bwget\b|\bunzip\b|\btar\b.*-x|\bgit\s+(checkout|restore|mv|rm|clean))/;

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

const tool = payload.tool_name ?? "";
const ti = payload.tool_input ?? {};
const targets = [];

if (tool === "Write" || tool === "Edit" || tool === "MultiEdit") {
  if (typeof ti.file_path === "string") targets.push({ text: ti.file_path, isCommand: false });
} else if (tool === "Bash") {
  if (typeof ti.command === "string") targets.push({ text: ti.command, isCommand: true });
}

for (const t of targets) {
  for (const f of FORBIDDEN) {
    if (!f.pattern.test(t.text)) continue;
    if (t.isCommand && !WRITE_WORDS.test(t.text)) continue; // 読むだけなら許可
    process.stderr.write(
      `拒否: ${f.label} への書き込みは禁止されています（.claude/settings.json のフック）。` +
        ` 秘密情報は wrangler secret、写真は開発者が手で置きます。\n`,
    );
    process.exit(2);
  }
}
process.exit(0);
