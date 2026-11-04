#!/usr/bin/env bash
# ローカルの Worker に対するスモークテスト。
# 使い方: pnpm dev:worker を起動してから  bash scripts/smoke.sh [http://localhost:8787]
#   本番 URL に対して流すときは EXPECT_PRODUCTION=1 を付ける（X-Dev-User が通らないことを確認する）
set -euo pipefail
BASE="${1:-http://localhost:8787}"
DEV_USER="${DEV_USER:-smoke@example.com}"
EXPECT_PRODUCTION="${EXPECT_PRODUCTION:-}"
fail() { echo "NG: $*" >&2; exit 1; }

echo "== /api/health"
health=$(curl -sf "$BASE/api/health") || fail "health が取れない"
echo "$health" | grep -q '"ok":true' || fail "health の ok が true でない: $health"

echo "== /api/me（認証なし → 401）"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/me")
[ "$code" = "401" ] || fail "認証なしが 401 でない: $code"

echo "== /api/me（X-Dev-User → development なら 200、production なら 401）"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Dev-User: $DEV_USER" "$BASE/api/me")
if [ -z "$EXPECT_PRODUCTION" ]; then
  [ "$code" = "200" ] || fail "development なのに X-Dev-User で 200 にならない: $code"
else
  [ "$code" = "401" ] || fail "production なのに X-Dev-User が通ってしまう: $code"
fi

echo "== 画面（/ と深いパスが text/html）"
for p in / /anything/deep; do
  ct=$(curl -s -o /dev/null -w '%{content_type}' "$BASE$p")
  echo "$ct" | grep -q 'text/html' || fail "$p が HTML でない: $ct"
done

if [ -z "$EXPECT_PRODUCTION" ]; then
  H="X-Dev-User: $DEV_USER"
  echo "== 記憶: 登録 → 一覧 → 1 件取得 → 削除 → 再取得 404"
  created=$(curl -sf -H "$H" -H 'content-type: application/json' -d '{"body":"スーパーで青梅を見かけた"}' "$BASE/api/memories") || fail "登録に失敗"
  id=$(echo "$created" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  [ -n "$id" ] || fail "登録の応答に id が無い: $created"
  curl -sf -H "$H" "$BASE/api/memories" | grep -q "\"id\":\"$id\"" || fail "一覧に出ない"
  curl -sf -H "$H" "$BASE/api/memories/$id" | grep -q '"recalled_by"' || fail "1 件取得の形が違う"
  echo "== 写真: PUT（1x1 PNG）→ GET → GIF は 415"
  png=$(mktemp); printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' | base64 -d > "$png"
  put=$(curl -sf -X PUT -H "$H" -F "photo=@$png;type=image/png" "$BASE/api/memories/$id/photo") || fail "写真の PUT に失敗"
  key=$(echo "$put" | sed -n 's/.*"photo_key":"\([^"]*\)".*/\1/p')
  [ -n "$key" ] || fail "photo_key が無い: $put"
  ct=$(curl -s -o /dev/null -w '%{content_type}' -H "$H" "$BASE/api/photos/$key")
  [ "$ct" = "image/png" ] || fail "写真の GET の content-type が違う: $ct"
  gif=$(mktemp); printf 'GIF89a' > "$gif"
  code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "$H" -F "photo=@$gif;type=image/gif" "$BASE/api/memories/$id/photo")
  [ "$code" = "415" ] || fail "GIF が 415 でない: $code"
  rm -f "$png" "$gif"
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "$H" "$BASE/api/memories/$id")
  [ "$code" = "204" ] || fail "削除が 204 でない: $code"
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$BASE/api/photos/$key")
  [ "$code" = "404" ] || fail "削除後も写真が残っている: $code"
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$BASE/api/memories/$id")
  [ "$code" = "404" ] || fail "削除後が 404 でない: $code"
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" -H 'content-type: application/json' -d '{"body":"   "}' "$BASE/api/memories")
  [ "$code" = "400" ] || fail "空の本文が 400 でない: $code"
fi

echo "OK: すべて通りました（$BASE${EXPECT_PRODUCTION:+, production}）"
