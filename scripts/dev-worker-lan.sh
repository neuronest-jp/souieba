#!/usr/bin/env bash
# 実機からローカルの Worker を叩くための起動（docs/setup-capacitor.md 1.1）。`pnpm dev:worker:lan`。
#
# LAN に出すので、`pnpm dev:worker`（development: X-Dev-User を受け付け、招待コード dev / 署名鍵 dev-only-secret は公開済み）
# とは違い、本番と同じ認証にする:
#   - ENVIRONMENT=lan（development ではない）→ X-Dev-User は無視、署名鍵は 32 文字以上が必須
#   - 招待コードは 1 人 1 つ（ADR-0007 2026-11-06 追記）。LAN_EMAIL（必須）に結びつけた乱数のコードを作り、
#     INVITE_CODE=<乱数>=<LAN_EMAIL> の形で渡す。ログインはこのコードとこのメールの組だけが通る
#   - 招待コードと署名鍵はこの端末で乱数から作り、.wrangler/lan-dev.secrets（gitignore 済み、600）に保存して次回も使う
#   - 秘密は wrangler の引数（--var）に載せず、--env-file でファイルから読ませる（引数はプロセスの一覧から同じホストの他人に読まれる）。
#     ローカルの設定ファイル（API キーなど）を先に、lan-dev.secrets を後に読ませ、招待コードと署名鍵は後のほうで上書きする
#   - 待ち受けは Mac の LAN の IP だけ（0.0.0.0 にしない。VPN などの他のインターフェースに出さない）
# 秘密を作り直すときはファイルを消す（端末のトークンは無効になり、ログイン画面に戻る）。
# 使い方: LAN_EMAIL=you@example.com pnpm dev:worker:lan
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="${LAN_SECRETS:-$ROOT/.wrangler/lan-dev.secrets}"

EMAIL="$(printf '%s' "${LAN_EMAIL:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
if ! printf '%s' "$EMAIL" | grep -Eq '^[^@,=]+@[^@,=]+\.[^@,=]+$'; then
  echo "LAN_EMAIL にログインに使うメールアドレスを指定してください（例: LAN_EMAIL=you@example.com pnpm dev:worker:lan）" >&2
  exit 1
fi

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
      echo "INVITE_CODE=$(openssl rand -hex 6)=$EMAIL"
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
case "$INVITE_CODE" in
  *=*) ;;
  *)
    echo "$SECRETS は古い形式です（招待コードがメールに結びついていません）。rm \"$SECRETS\" で消してから実行し直してください" >&2
    exit 1
    ;;
esac
SAVED_EMAIL="${INVITE_CODE#*=}"
if [ "$SAVED_EMAIL" != "$EMAIL" ]; then
  echo "$SECRETS の招待コードは $SAVED_EMAIL 用です。そのメールで使うか、ファイルを消して作り直してください" >&2
  exit 1
fi

PORT="${LAN_PORT:-8787}"
echo "Worker: http://${IP}:${PORT}（web/.env.local の VITE_API_BASE をこれに）"
echo "招待コード: ${INVITE_CODE%%=*}（アプリのログイン画面で、メール $EMAIL と一緒に入れる）"

mkdir -p "$ROOT/web/dist"
cd "$ROOT"
# 秘密でない値だけを --var に残す。秘密は --env-file（後のファイルが前のファイルを上書きする）
ENV_FILES=()
[ -f "$ROOT/.dev.vars" ] && ENV_FILES+=(--env-file "$ROOT/.dev.vars")
ENV_FILES+=(--env-file "$SECRETS")
exec wrangler dev --ip "$IP" --port "$PORT" \
  --var ENVIRONMENT:lan \
  "${ENV_FILES[@]}"
