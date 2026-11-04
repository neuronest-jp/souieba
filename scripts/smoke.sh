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
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "$H" "$BASE/api/memories/$id")
  [ "$code" = "204" ] || fail "削除が 204 でない: $code"
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" "$BASE/api/memories/$id")
  [ "$code" = "404" ] || fail "削除後が 404 でない: $code"
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "$H" -H 'content-type: application/json' -d '{"body":"   "}' "$BASE/api/memories")
  [ "$code" = "400" ] || fail "空の本文が 400 でない: $code"
fi

echo "OK: すべて通りました（$BASE${EXPECT_PRODUCTION:+, production}）"
