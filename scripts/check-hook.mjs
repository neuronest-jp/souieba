// .claude/hooks/guard-writes.mjs の回帰テスト。`pnpm check:hook` または CI で実行する。
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = resolve(ROOT, ".claude/hooks/guard-writes.mjs");
const V = ".dev.vars";

const run = (tool, input) =>
  spawnSync("node", [HOOK], { input: JSON.stringify({ tool_name: tool, tool_input: input }), encoding: "utf8" }).status;

const ALLOW = 0;
const DENY = 2;
const cases = [
  // ファイル系ツール
  [ALLOW, "Write", { file_path: `/x/${V}.example` }],
  [DENY, "Write", { file_path: `/x/${V}` }],
  [DENY, "Edit", { file_path: `/x/${V}.production` }],
  [DENY, "NotebookEdit", { notebook_path: `/x/${V}` }],
  [DENY, "Write", { file_path: "/x/demo/photos/a.jpg" }],
  [ALLOW, "Edit", { file_path: "/x/docs/spec.md" }],
  // Bash: 読むだけは許可
  [ALLOW, "Bash", { command: `cat ${V}` }],
  [ALLOW, "Bash", { command: "ls demo/photos/" }],
  [ALLOW, "Bash", { command: "pnpm install && cat demo/photos/README.md" }],
  [ALLOW, "Bash", { command: "ls demo/photos && mkdir -p tmp" }],
  [ALLOW, "Bash", { command: `grep -n KEY ${V} | head` }],
  // Bash: 書き込みは拒否
  [DENY, "Bash", { command: `echo X > ${V}` }],
  [DENY, "Bash", { command: `echo X >${V}` }],
  [DENY, "Bash", { command: `cp a ${V}` }],
  [DENY, "Bash", { command: "mkdir -p demo/photos" }],
  [DENY, "Bash", { command: `node -e "require('fs').writeFileSync('${V}','x')"` }],
  [DENY, "Bash", { command: `python3 -c "open('${V}','w').write('x')"` }],
  [DENY, "Bash", { command: `cat a | tee ${V}` }],
  [DENY, "Bash", { command: `sed -i s/a/b/ ${V}` }],
  [DENY, "Bash", { command: "curl -o demo/photos/x.jpg https://example.com/x.jpg" }],
  [DENY, "Bash", { command: `cat ${V} > out.txt && echo ok` }],
  // ヒアドキュメント本文に名前が出るだけなら許可
  [ALLOW, "Bash", { command: `cat > docs/x.md <<'EOF'\n${V} に秘密を書く\ndemo/photos/ に写真を置く\nEOF\necho done` }],
  // ヒアドキュメント本文を実行系に流す場合は判定する
  [DENY, "Bash", { command: `bash <<'EOF'\necho x > ${V}\nEOF` }],
  [DENY, "Bash", { command: `python3 - <<'EOF'\nopen('${V}','w')\nEOF` }],
  // ヒアドキュメントの出力先が禁止パスなら拒否
  [DENY, "Bash", { command: `cat > ${V} <<'EOF'\nA=1\nEOF` }],
  // ios/ android/ の署名ファイル（ADR-0007）
  [DENY, "Write", { file_path: "/x/ios/App/App/ExportOptions.plist" }],
  [DENY, "Write", { file_path: "/x/ios/certs/dist.mobileprovision" }],
  [DENY, "Edit", { file_path: "/x/android/key.properties" }],
  [DENY, "Write", { file_path: "/x/android/app/release.keystore" }],
  [DENY, "Write", { file_path: "/x/android/app/google-services.json" }],
  [DENY, "Write", { file_path: "/x/ios/App/App/GoogleService-Info.plist" }],
  [DENY, "Bash", { command: "cp ~/dist.p12 ios/App/" }],
  [DENY, "Bash", { command: "keytool -genkey -keystore android/app/upload.jks" }],
  [ALLOW, "Write", { file_path: "/x/ios/App/App/Info.plist" }],
  [ALLOW, "Edit", { file_path: "/x/android/app/build.gradle" }],
  [ALLOW, "Bash", { command: "ls ios/App/App/ExportOptions.plist" }],
  [ALLOW, "Bash", { command: "cat android/gradle.properties" }],
  // 実行系と文書のヒアドキュメントが混在しても、文書側の本文は判定しない
  [ALLOW, "Bash", { command: `python3 - <<'PY'\nprint(1)\nPY\ncat > docs/x.md <<'EOF'\n- \`cat ${V}\` のような読み取り\nEOF\necho ok` }],
  [DENY, "Bash", { command: `python3 - <<'PY'\nopen('${V}','w')\nPY\ncat > docs/x.md <<'EOF'\n本文\nEOF` }],
];

let failed = 0;
for (const [expected, tool, input] of cases) {
  const got = run(tool, input);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "ok " : "NG "} expect=${expected} got=${got} ${tool} ${JSON.stringify(input).slice(0, 90)}`);
}
console.log(failed === 0 ? `ALL OK (${cases.length})` : `FAILED: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
