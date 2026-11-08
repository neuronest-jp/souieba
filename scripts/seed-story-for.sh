#!/usr/bin/env bash
# 審査員など、別の利用者のぶんの物語のデータ（88 件。demo/fixtures/story.py）を D1 に入れる（ADR-0016）。
#
# 使い方:
#   bash scripts/seed-story-for.sh judge1@example.com judge2@example.com …   # 本番の D1（--remote）
#   env LOCAL=1 bash scripts/seed-story-for.sh judge1@example.com           # 手元の D1（--local）
#
# - メールごとに id の前置き（メールの @ より前。英小文字と数字以外は _ に）を変えて story.py で作り、
#   .wrangler/story-<前置き>.sql（gitignore 済み）に置いてから流す。同じ D1 に何人ぶん入れてもぶつからない
# - 入れ直すと、その利用者の行は消えて入り直る（story.sql と同じ）。写真は無い
# - 招待コード（INVITE_CODE の対応表）はここでは扱わない。docs/setup-cloudflare.md 4.1 のとおり開発者が入れる
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ $# -lt 1 ]; then
  echo "使い方: bash scripts/seed-story-for.sh <メール> [<メール> …]（本番）。手元なら env LOCAL=1 を付ける" >&2
  exit 1
fi
mode=(--remote --yes)
[ -n "${LOCAL:-}" ] && mode=(--local)
mkdir -p .wrangler

for email in "$@"; do
  email="$(printf '%s' "$email" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  printf '%s' "$email" | grep -Eq '^[^@,=/?#%[:space:]]+@[^@,=/?#%[:space:]]+\.[^@,=/?#%[:space:]]+$' || {
    echo "メールの形が違います: $email" >&2
    exit 1
  }
  prefix="$(printf '%s' "${email%%@*}" | tr -c 'a-z0-9' '_')_"
  out=".wrangler/story-${prefix%_}.sql"
  python3 demo/fixtures/story.py "$out" --user "$email" --prefix "$prefix" >/dev/null
  echo "== ${email} → ${out}（${mode[0]}）"   # bash 3.2 は $変数 の直後の全角文字を変数名に含めて読むので ${…} で囲む
  pnpm exec wrangler d1 execute souieba "${mode[@]}" --file "$out"
done
echo "入れました: $#"
