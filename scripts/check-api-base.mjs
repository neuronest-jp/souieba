// アプリに埋め込む API の向き先（VITE_API_BASE）の見張り。`pnpm cap:sync`（と、それを呼ぶ cap:ios / cap:android）の先頭で走る。
// - 読む順は vite build（mode は production）と同じ: 環境変数 → web/.env.production.local → web/.env.production → web/.env.local → web/.env。
//   先に見つかった方が勝つ。空の値で書いてあっても「見つかった」とする（vite も空の値で上書きする）
// - 空なら止める（exit 1）。画面は同一オリジンの /api を叩くが、アプリ（capacitor://localhost）の同一オリジンに API は無い
// - http:// の localhost・LAN の IP（10.* / 172.16-31.* / 192.168.*）・*.local なら「開発用の向き先」と 1 行出して続ける
// - https:// ならそのまま続ける
// - それ以外（http:// の公開ホスト、URL でない値）も止める。iOS は http を手元のネットワークにしか許さない（Info.plist の NSAllowsLocalNetworking）
// 値は秘密ではないので出す。web のディレクトリは引数で変えられる（テスト用）: node scripts/check-api-base.mjs [web のディレクトリ]
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "VITE_API_BASE";
// 強い順（vite の loadEnv は .env → .env.local → .env.[mode] → .env.[mode].local の順に重ね、後のものが勝つ）
const FILES = [".env.production.local", ".env.production", ".env.local", ".env"];

/** .env の 1 ファイルから key の値を返す（無ければ undefined）。dotenv と同じく export・クォート・行末の # コメントを扱う */
export const readDotenv = (src, key) => {
  let found;
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*[=:]\s*(.*)$/);
    if (!m || m[1] !== key) continue;
    const raw = (m[2] ?? "").trim();
    const q = raw[0];
    const close = q === '"' || q === "'" || q === "`" ? raw.indexOf(q, 1) : -1;
    // 同じキーが 2 度あれば後の行が勝つ（dotenv と同じ）
    found = close > 0 ? raw.slice(1, close) : raw.replace(/#.*$/, "").trim();
  }
  return found;
};

/** 向き先とその出どころ。どこにも無ければ value は undefined */
export const resolveApiBase = (env, webDir) => {
  if (Object.hasOwn(env, KEY)) return { value: env[KEY], from: `環境変数 ${KEY}` };
  for (const name of FILES) {
    const file = join(webDir, name);
    if (!existsSync(file)) continue;
    const value = readDotenv(readFileSync(file, "utf8"), KEY);
    if (value !== undefined) return { value, from: relative(ROOT, file) || file };
  }
  return { value: undefined, from: null };
};

const isDevHost = (host) =>
  host === "localhost" ||
  host.endsWith(".localhost") ||
  host.endsWith(".local") ||
  host === "[::1]" ||
  /^127\.\d+\.\d+\.\d+$/.test(host) ||
  /^10\.\d+\.\d+\.\d+$/.test(host) ||
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host) ||
  /^192\.168\.\d+\.\d+$/.test(host);

/** 値を見分ける（純粋関数）: ok = https、dev = 手元の http、stop = 止める（reason に理由） */
export const classify = (value) => {
  if (value === undefined || value.trim() === "") return { kind: "stop", reason: "空。アプリの画面から API に届かない" };
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return { kind: "stop", reason: "URL として読めない" };
  }
  if (url.protocol === "https:") return { kind: "ok" };
  if (url.protocol === "http:" && isDevHost(url.hostname)) return { kind: "dev" };
  if (url.protocol === "http:") return { kind: "stop", reason: "http:// の公開ホスト。iOS は http を手元のネットワークにしか許さない（本番は https://）" };
  return { kind: "stop", reason: `${url.protocol} は使えない（https:// か、開発なら手元の http://）` };
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const webDir = resolve(process.argv[2] ?? join(ROOT, "web"));
  const { value, from } = resolveApiBase(process.env, webDir);
  const shown = value === undefined ? "（どこにも書いていない）" : JSON.stringify(value);
  const where = from ?? `環境変数と ${FILES.map((f) => relative(ROOT, join(webDir, f)) || f).join(" / ")}`;
  const result = classify(value);
  if (result.kind === "stop") {
    console.error(`NG: ${KEY} = ${shown}（${where}）: ${result.reason}`);
    console.error(`  アプリは ${KEY} の /api を叩く。配布するビルドなら web/.env.production に本番の https:// を書く（見本は web/.env.example）`);
    console.error("  手元の Worker を叩くなら web/.env.local か環境変数に http://localhost:8787 や http://<LAN の IP>:8787 を書く");
    process.exit(1);
  }
  if (result.kind === "dev") console.log(`check-api-base: 開発用の向き先: ${KEY}=${value}（${where}）。配布するビルドには使わない`);
  else console.log(`check-api-base OK: ${KEY}=${value}（${where}）`);
}
