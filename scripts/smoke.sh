#!/usr/bin/env bash
# Worker に対するスモークテスト（T-1104-17）。
#
# ローカル: pnpm dev:worker を起動してから  bash scripts/smoke.sh [http://localhost:8787]
#   開発用の招待コード dev でログイン → Bearer で きょう・つながりの GET → 記憶の登録 → 詳細 → 写真の PUT / GET → 別のユーザーで 404 → 削除 → 削除後 404。
#   別のユーザーは X-Dev-User で作る（development だけ有効）。
#
# 本番: EXPECT_PRODUCTION=1 bash scripts/smoke.sh https://souieba.<account>.workers.dev
#   X-Dev-User が通らないこと、ログインの 401 / 400、画面の HTML を確かめる。
#   招待コードを環境変数で渡すと、同じ流れを本番でも通す（INVITE_CODE の対応表の 1 行。ADR-0007 2026-11-06 追記）:
#     SMOKE_INVITE_CODE / SMOKE_EMAIL                  … 1 人目（必須）。他人のメールでは 401 になることも確かめる
#     SMOKE_OTHER_INVITE_CODE / SMOKE_OTHER_EMAIL      … 2 人目（任意）。あれば「別のユーザーで 404」を確かめる
#   値はスクリプトにもログにも書かない（curl の引数にも載せず、標準入力で渡す）。履歴に残したくなければ read -s で読む。
#   本番では実際に 1 件登録して最後に消す（候補抽出と想起も 1 回ずつ走る）。途中で失敗しても消してから終わる。
set -euo pipefail
BASE="${1:-http://localhost:8787}"
DEV_USER="${DEV_USER:-smoke@example.com}"
OTHER_DEV_USER="${OTHER_DEV_USER:-smoke-other@example.com}"
EXPECT_PRODUCTION="${EXPECT_PRODUCTION:-}"
fail() { echo "NG: $*" >&2; exit 1; }

# ログインして token を標準出力に返す。招待コードは標準入力で curl に渡す（ps やログに出さない）
login_token() {
  local code="$1" email="$2" out
  out=$(printf '{"invite_code":"%s","email":"%s"}' "$code" "$email" |
    curl -s -w '\n%{http_code}' -H 'content-type: application/json' --data-binary @- "$BASE/api/auth/login") || return 1
  local status="${out##*$'\n'}"
  [ "$status" = "429" ] && fail "ログインのレート制限中（同じ IP から 1 分 10 回）。1 分待ってから再実行してください"
  [ "$status" = "200" ] || { echo "status=$status" >&2; return 1; }
  printf '%s' "${out%$'\n'*}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}
login_status() {
  local code="$1" email="$2"
  printf '{"invite_code":"%s","email":"%s"}' "$code" "$email" |
    curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' --data-binary @- "$BASE/api/auth/login"
}

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

echo "== /api/auth/login（招待コード違いは 401、入力不足は 400）"
code=$(login_status "definitely-wrong" "smoke@example.com")
[ "$code" = "429" ] && fail "ログインのレート制限中（同じ IP から 1 分 10 回）。1 分待ってから再実行してください"
[ "$code" = "401" ] || fail "招待コード違いが 401 でない: $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"email":"smoke@example.com"}' "$BASE/api/auth/login")
[ "$code" = "400" ] || fail "入力不足が 400 でない: $code"

# 流れに使う 2 人分の認証ヘッダを決める
A1="" A2="" ME=""
if [ -z "$EXPECT_PRODUCTION" ]; then
  echo "== /api/auth/login（開発用の招待コード dev → JWT）"
  tok=$(login_token "dev" "$DEV_USER") || fail "dev でログインできない"
  [ -n "$tok" ] || fail "ログインで token が返らない"
  A1="Authorization: Bearer $tok"
  A2="X-Dev-User: $OTHER_DEV_USER"
  ME="$DEV_USER"
else
  if [ -z "${SMOKE_INVITE_CODE:-}" ] || [ -z "${SMOKE_EMAIL:-}" ]; then
    echo "（SMOKE_INVITE_CODE / SMOKE_EMAIL が無いので、記憶の流れは飛ばします）"
    echo "OK: すべて通りました（$BASE, production、ログイン後の流れは未確認）"
    exit 0
  fi
  ME="$(printf '%s' "$SMOKE_EMAIL" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  echo "== /api/auth/login（SMOKE_INVITE_CODE と SMOKE_EMAIL → JWT。同じコードで他人のメールは 401）"
  tok=$(login_token "$SMOKE_INVITE_CODE" "$SMOKE_EMAIL") || fail "SMOKE_INVITE_CODE と SMOKE_EMAIL でログインできない（対応表の組を確認）"
  [ -n "$tok" ] || fail "ログインで token が返らない"
  A1="Authorization: Bearer $tok"
  code=$(login_status "$SMOKE_INVITE_CODE" "not-$ME")
  [ "$code" = "401" ] || fail "正しい招待コードに他人のメールで 401 にならない（なりすまし）: $code"
  if [ -n "${SMOKE_OTHER_INVITE_CODE:-}" ] && [ -n "${SMOKE_OTHER_EMAIL:-}" ]; then
    tok2=$(login_token "$SMOKE_OTHER_INVITE_CODE" "$SMOKE_OTHER_EMAIL") || fail "SMOKE_OTHER_INVITE_CODE と SMOKE_OTHER_EMAIL でログインできない"
    A2="Authorization: Bearer $tok2"
  else
    echo "（SMOKE_OTHER_INVITE_CODE / SMOKE_OTHER_EMAIL が無いので、別のユーザーでの 404 は飛ばします）"
  fi
fi

curl -sf -H "$A1" "$BASE/api/me" | grep -q "\"user_id\":\"$ME\"" || fail "JWT で /api/me が通らない"

echo "== きょう・つながり: Bearer で GET /api/today と /api/connections が 200"
out=$(curl -s -w '\n%{http_code}' -H "$A1" "$BASE/api/today")
code="${out##*$'\n'}"
[ "$code" = "200" ] || fail "GET /api/today が 200 でない: $code"
printf '%s' "${out%$'\n'*}" | grep -q '"week"' || fail "GET /api/today の形が違う（week が無い）"
out=$(curl -s -w '\n%{http_code}' -H "$A1" "$BASE/api/connections")
code="${out##*$'\n'}"
[ "$code" = "200" ] || fail "GET /api/connections が 200 でない: $code"
printf '%s' "${out%$'\n'*}" | grep -q '"beads"' || fail "GET /api/connections の形が違う（beads が無い）"

# 途中で失敗しても、作った記憶は消してから終わる
id="" key="" png="" gif=""
cleanup() {
  [ -n "$id" ] && curl -s -o /dev/null -X DELETE -H "$A1" "$BASE/api/memories/$id" || true
  rm -f "$png" "$gif"
}
trap cleanup EXIT

echo "== 記憶: 登録 → 一覧 → 詳細"
created=$(curl -sf -H "$A1" -H 'content-type: application/json' -d '{"body":"スモークテスト: スーパーで青梅を見かけた"}' "$BASE/api/memories") || fail "登録に失敗"
id=$(echo "$created" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
[ -n "$id" ] || fail "登録の応答に id が無い: $created"
curl -sf -H "$A1" "$BASE/api/memories" | grep -q "\"id\":\"$id\"" || fail "一覧に出ない"
curl -sf -H "$A1" "$BASE/api/memories/$id" | grep -q '"recalled_by"' || fail "詳細の形が違う"

echo "== 候補と札: GET facts / recalls が { pending, items } を返す"
curl -sf -H "$A1" "$BASE/api/memories/$id/facts" | grep -q '"pending"' || fail "facts の形が違う"
curl -sf -H "$A1" "$BASE/api/memories/$id/recalls" | grep -q '"items"' || fail "recalls の形が違う"
code=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "$A1" -H 'content-type: application/json' -d '{"status":"confirmed"}' "$BASE/api/facts/nope")
[ "$code" = "404" ] || fail "無い候補の PATCH が 404 でない: $code"

echo "== 写真: PUT（1x1 PNG）→ GET → GIF は 415"
png=$(mktemp); printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' | base64 -d > "$png"
put=$(curl -sf -X PUT -H "$A1" -F "photo=@$png;type=image/png" "$BASE/api/memories/$id/photo") || fail "写真の PUT に失敗"
key=$(echo "$put" | sed -n 's/.*"photo_key":"\([^"]*\)".*/\1/p')
[ -n "$key" ] || fail "photo_key が無い: $put"
ct=$(curl -s -o /dev/null -w '%{content_type}' -H "$A1" "$BASE/api/photos/$key")
[ "$ct" = "image/png" ] || fail "写真の GET の content-type が違う: $ct"
curl -sf -H "$A1" "$BASE/api/memories/$id" | grep -q "\"photo_key\":\"$key\"" || fail "詳細に photo_key が載らない"
gif=$(mktemp); printf 'GIF89a' > "$gif"
code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "$A1" -F "photo=@$gif;type=image/gif" "$BASE/api/memories/$id/photo")
[ "$code" = "415" ] || fail "GIF が 415 でない: $code"

if [ -n "$A2" ]; then
  echo "== 別のユーザー: 詳細・写真・削除・写真の PUT はどれも 404、一覧に出ない"
  for path in "/api/memories/$id" "/api/photos/$key" "/api/memories/$id/facts" "/api/memories/$id/recalls"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -H "$A2" "$BASE$path")
    [ "$code" = "404" ] || fail "別のユーザーで GET $path が 404 でない: $code"
  done
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "$A2" "$BASE/api/memories/$id")
  [ "$code" = "404" ] || fail "別のユーザーの DELETE が 404 でない: $code"
  code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "$A2" -F "photo=@$png;type=image/png" "$BASE/api/memories/$id/photo")
  [ "$code" = "404" ] || fail "別のユーザーの写真 PUT が 404 でない: $code"
  if curl -sf -H "$A2" "$BASE/api/memories" | grep -q "\"id\":\"$id\""; then fail "別のユーザーの一覧に出てしまう"; fi
  # 別のユーザーの操作で消えていない
  curl -sf -H "$A1" "$BASE/api/memories/$id" >/dev/null || fail "別のユーザーの DELETE で消えてしまった"
fi

echo "== 削除 → 削除後は記憶も写真も 404"
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "$A1" "$BASE/api/memories/$id")
[ "$code" = "204" ] || fail "削除が 204 でない: $code"
deleted_id="$id"; id=""
code=$(curl -s -o /dev/null -w '%{http_code}' -H "$A1" "$BASE/api/memories/$deleted_id")
[ "$code" = "404" ] || fail "削除後が 404 でない: $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "$A1" "$BASE/api/photos/$key")
[ "$code" = "404" ] || fail "削除後も写真が残っている: $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "$A1" -H 'content-type: application/json' -d '{"body":"   "}' "$BASE/api/memories")
[ "$code" = "400" ] || fail "空の本文が 400 でない: $code"

echo "OK: すべて通りました（$BASE${EXPECT_PRODUCTION:+, production}${A2:+、別のユーザーも確認}）"
