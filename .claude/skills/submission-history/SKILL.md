---
name: submission-history
description: 提出用の公開リポジトリに出す履歴を、使い捨ての複製の中で作り直す（期間中のコミットだけ、クレジットのトレーラーと端末の情報を除く）。「提出用のリポジトリを作る」「公開する履歴を作る」「最終版を押し上げる準備」のときに使う。
---

# 提出用の履歴を作る

ハッカソンの規約では、期間前のコードは持ち込めない。このリポジトリの根元には別作品（雪かき）のコミットがあり、そのうち 2 本は期間前（11/2）の日付になっている。
そこで、そういえば。の最初のコミット（32147a9、2026-11-03。旧コードを全部消した。ADR-0002）を根にした履歴を、**使い捨ての複製の中だけで**作る。
手元のリポジトリとブランチは変えない。押し上げ（push）と公開は、開発者の了解を取ってから行う。

## 1. 複製を作る

```sh
S=<作業場所の一時ディレクトリ>/submission
rm -rf "$S"
git clone -q --no-local --single-branch --branch <最新のブランチ> <このリポジトリのパス> "$S"
cd "$S"
```

## 2. 根を付け替え、メッセージと中身を整える

- 根の付け替え: `git replace --graft 32147a9`（32147a9 に親を持たせない）
- メッセージ: `Claude-Session:` と `Co-Authored-By:` の行を消す（開発者の設定では付けないことになっている。11/4〜11/5 のクラウドのセッションの分に付いていた）
- 中身: `docs/handoff-2026-11-05.md` の端末の情報（UDID、LAN の IP、VPN の IP、チーム ID、証明書の個人 ID）は、いまの版では伏せ字にしてある。
  過去のコミットにも同じ伏せ字を当てる。元の値は、伏せ字にしたコミットの差分から読む（`git log -p -S'<UDID>' -- docs/handoff-2026-11-05.md`）。値は会話・文書・コミットに写さない

```sh
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f \
  --msg-filter 'sed -e "/^Claude-Session: /d" -e "/^Co-Authored-By: /d" | awk "{l[NR]=\$0} END {n=NR; while (n>0 && l[n] ~ /^[[:space:]]*$/) n--; for (i=1;i<=n;i++) print l[i]}"' \
  --tree-filter "if [ -f docs/handoff-2026-11-05.md ]; then sed -i '' -f <作業場所の外に置いた置き換えの sed>.sed docs/handoff-2026-11-05.md; fi" \
  -- --all
git replace -d 32147a9
# 11/7 の 1 回目: 108 コミット、tree は元の HEAD と同じ、トレーラーと端末の値は 0 件。push 先 neuronest-jp/souieba（非公開）
for r in $(git for-each-ref --format='%(refname)' refs/original refs/replace); do git update-ref -d "$r"; done
git reflog expire --expire=now --all && git gc -q --prune=now
```

## 3. 確かめる

- 根が 2026-11-03 の「そういえば。」の最初のコミットであること（`git rev-list --max-parents=0 HEAD | xargs git log -1 --format='%h %ad %s'`）
- 最後の tree が元のブランチの HEAD と同じこと（伏せ字を当てた `docs/handoff-2026-11-05.md` だけは、いまの版でも伏せ字なので同じになる）
- 旧コミット（d04bc97、8aa9cd4、424586e、1d14354、f7d0e82）が `git cat-file -e` で見つからないこと
- `git log --all --format=%B | grep -c -e '^Claude-Session:' -e '^Co-Authored-By:'` が 0 のこと
- `git grep -I` と `git log -p --all` で、端末の情報・`sk-ant-` などの秘密らしい値が出ないこと

## 4. 押し上げる（開発者の了解のあと）

新しいリポジトリは、まず非公開で作る。名前と説明文は docs/submission.md の案を使い、変えるなら開発者に聞く。

```sh
gh repo create <owner>/<name> --private --description "<説明文>"
git push <新しいリポジトリの URL> HEAD:main
```

README を GitHub 上で読んで確かめたあと、開発者の了解を取って公開に切り替える（`gh repo edit <owner>/<name> --visibility public --accept-visibility-change-consequences`）。
