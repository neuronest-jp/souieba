#!/usr/bin/env bash
# 本番への配備（`pnpm run deploy`。ADR-0016）。画面を組んで、乱数の名前の Worker に deploy する。
#
# - Worker 名は .wrangler/worker-name（gitignore 済み）に置いた乱数の名前。無ければここで作る（英字 1 字 + 16 進 20 桁）。
#   wrangler.toml の name（souieba）では配備しない。souieba.<account>.workers.dev は推測できる URL になるため。
#   名前はリポジトリ・README・文書に書かない（提出フォームにだけ書く）。
# - 画面は VITE_API_BASE を空にして組む（同じ Worker の /api を叩く）。web/.env.local に手元の向き先（LAN の IP など）が
#   残っていても、環境変数のほうが勝つ。組んだ画面に手元の向き先が入っていないことも確かめる。
# - 秘密（ANTHROPIC_API_KEY / INVITE_CODE / JWT_SECRET）はここでは扱わない。docs/setup-cloudflare.md 4.1 のとおり
#   `wrangler secret put <名前> --name <Worker 名>` で開発者が入れる。D1 / R2 の作成も同じ手順書の 2 節・3 節。
# - 追加の引数は wrangler deploy にそのまま渡す（例: pnpm run deploy -- --dry-run）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME_FILE="${WORKER_NAME_FILE:-$ROOT/.wrangler/worker-name}"
cd "$ROOT"

if [ ! -s "$NAME_FILE" ]; then
  mkdir -p "$(dirname "$NAME_FILE")"
  printf 'w%s\n' "$(openssl rand -hex 10)" >"$NAME_FILE"
  echo "Worker 名を作りました: $NAME_FILE（この名前が URL になる。文書やリポジトリに書かない）"
fi
WORKER="$(tr -d '[:space:]' <"$NAME_FILE")"
case "$WORKER" in
  "" | souieba)
    echo "Worker 名が空か souieba です（$NAME_FILE）。推測できない名前にしてください" >&2
    exit 1
    ;;
esac
printf '%s' "$WORKER" | grep -Eq '^[a-z][a-z0-9-]{7,62}$' || {
  echo "Worker 名の形が違います（英小文字で始まり、英小文字・数字・ハイフンで 8〜63 文字）: $NAME_FILE" >&2
  exit 1
}
if grep -q '00000000-0000-0000-0000-000000000000' wrangler.toml; then
  echo "wrangler.toml の database_id が仮の値のままです。docs/setup-cloudflare.md 2 節（wrangler d1 create souieba）を先に" >&2
  exit 1
fi

echo "== 画面を組む（VITE_API_BASE は空 = 同じ Worker の /api）"
env VITE_API_BASE= pnpm build:web

# 組んだ画面に手元の向き先（localhost のポートや LAN の IP）が残っていないか
leaked="$(grep -ohE 'https?://(localhost|127\.0\.0\.1|10\.[0-9.]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9.]+|192\.168\.[0-9.]+)(:[0-9]+)?[^"'"'"' ]*' web/dist/assets/*.js 2>/dev/null | grep -E ':[0-9]+' | sort -u || true)"
if [ -n "$leaked" ]; then
  echo "組んだ画面に手元の向き先が入っています。web/.env.* を確かめてください:" >&2
  echo "$leaked" >&2
  exit 1
fi

echo "== deploy: Worker 名 $WORKER"
pnpm exec wrangler deploy --name "$WORKER" "$@"
echo
echo "次: 秘密を入れていなければ docs/setup-cloudflare.md 4.1（--name $WORKER を付ける）。疎通は docs/submission.md「本番の手順」6"
