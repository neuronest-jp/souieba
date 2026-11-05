#!/usr/bin/env bash
# 実機からローカルの Worker を叩くための起動（docs/setup-capacitor.md 1.1）。`pnpm dev:worker:lan`。
#
# LAN に出すので、`pnpm dev:worker`（development: X-Dev-User を受け付け、招待コード dev / 署名鍵 dev-only-secret は公開済み）
# とは違い、本番と同じ認証にする:
#   - ENVIRONMENT=lan（development ではない）→ X-Dev-User は無視、署名鍵は 32 文字以上が必須
#   - 招待コードと署名鍵はこの端末で乱数から作り、.wrangler/lan-dev.secrets（gitignore 済み、600）に保存して次回も使う
#   - 待ち受けは Mac の LAN の IP だけ（0.0.0.0 にしない。VPN などの他のインターフェースに出さない）
# 秘密を作り直すときはファイルを消す（端末のトークンは無効になり、ログイン画面に戻る）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="$ROOT/.wrangler/lan-dev.secrets"

IP="${LAN_IP:-}"
if [ -z "$IP" ] && command -v ipconfig >/dev/null 2>&1; then
  IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
fi
if [ -z "$IP" ]; then
  echo "LAN の IP が分かりません。LAN_IP=192.168.x.x pnpm dev:worker:lan のように指定してください" >&2
  exit 1
fi

if [ ! -s "$SECRETS" ]; then
  mkdir -p "$(dirname "$SECRETS")"
  (
    umask 077
    {
      echo "INVITE_CODE=$(openssl rand -hex 6)"
      echo "JWT_SECRET=$(openssl rand -hex 32)"
    } >"$SECRETS"
  )
  echo "招待コードと署名鍵を作りました: $SECRETS"
fi
chmod 600 "$SECRETS"

INVITE_CODE="$(sed -n 's/^INVITE_CODE=//p' "$SECRETS")"
JWT_SECRET="$(sed -n 's/^JWT_SECRET=//p' "$SECRETS")"
if [ -z "$INVITE_CODE" ] || [ "${#JWT_SECRET}" -lt 32 ]; then
  echo "$SECRETS の中身が足りません。消してから実行し直してください" >&2
  exit 1
fi

echo "Worker: http://$IP:8787（web/.env.local の VITE_API_BASE をこれに）"
echo "招待コード: $INVITE_CODE（アプリのログイン画面で入れる。メールは任意）"

mkdir -p "$ROOT/web/dist"
cd "$ROOT"
exec wrangler dev --ip "$IP" \
  --var ENVIRONMENT:lan \
  --var "INVITE_CODE:$INVITE_CODE" \
  --var "JWT_SECRET:$JWT_SECRET"
