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
- 中身（パス）: `docs/handoff-2026-11-05.md` と `docs/submission.md` の古い版には、開発者の Mac の絶対パス（利用者名を含む）とクラウドの旧名のパスが残っている。
  置き換えの sed に次の 3 行を、この順で足す（`<名前>` は開発者の Mac の利用者名）。足さないと公開済みの履歴とハッシュがずれて、早送りで push できない（11/8 に確かめた）
  - `s#/Users/<名前>/github/yui/\.claude/worktrees/[A-Za-z0-9_-]*#~/github/souieba#g`
  - `s#/Users/<名前>/github/yui#~/github/souieba#g`
  - `s#/home/user/yui#/home/user/souieba#g`
- 作者: 開発者のメールアドレス（`git config user.email`）を `noreply@neuronest.jp` に替える（11/7 開発者の判断。名前はそのまま。Claude 名義の `noreply@anthropic.com` は変えない）

```sh
FILTER_BRANCH_SQUELCH_WARNING=1 OLD_EMAIL="$(git config user.email)" git filter-branch -f \
  --env-filter 'if [ "$GIT_AUTHOR_EMAIL" = "$OLD_EMAIL" ]; then export GIT_AUTHOR_EMAIL=noreply@neuronest.jp; fi; if [ "$GIT_COMMITTER_EMAIL" = "$OLD_EMAIL" ]; then export GIT_COMMITTER_EMAIL=noreply@neuronest.jp; fi' \
  --msg-filter 'sed -e "/^Claude-Session: /d" -e "/^Co-Authored-By: /d" | awk "{l[NR]=\$0} END {n=NR; while (n>0 && l[n] ~ /^[[:space:]]*$/) n--; for (i=1;i<=n;i++) print l[i]}"' \
  --tree-filter "for f in docs/handoff-2026-11-05.md docs/submission.md; do [ -f \$f ] && sed -i '' -f <作業場所の外に置いた置き換えの sed>.sed \$f; done; true" \
  -- --all
git replace -d 32147a9
# 11/7 の 2 回目: 110 コミット、tree は元の HEAD と同じ、トレーラー・端末の値・元のメールアドレスは 0 件。push 先 neuronest-jp/souieba（非公開、--force）
# 11/8: 公開済み（PUBLIC）の neuronest-jp/souieba に、早送りで足した（--force なし）。公開後は必ず早送りになることを確かめてから push する
# OLD_EMAIL は手元のリポジトリで読んだ値と同じか確かめる（git -C <このリポジトリのパス> config user.email。リポジトリごとの設定があればそちらが効く）
for r in $(git for-each-ref --format='%(refname)' refs/original refs/replace); do git update-ref -d "$r"; done
git reflog expire --expire=now --all && git gc -q --prune=now
```

## 3. 確かめる

- 根が 2026-11-03 の「そういえば。」の最初のコミットであること（`git rev-list --max-parents=0 HEAD | xargs git log -1 --format='%h %ad %s'`）
- 最後の tree が元のブランチの HEAD と同じこと（伏せ字を当てた `docs/handoff-2026-11-05.md` だけは、いまの版でも伏せ字なので同じになる）
- 旧コミット（d04bc97、8aa9cd4、424586e、1d14354、f7d0e82）が `git cat-file -e` で見つからないこと
- `git log --all --format=%B | grep -c -e '^Claude-Session:' -e '^Co-Authored-By:'` が 0 のこと
- `git grep -I` と `git log -p --all` で、端末の情報・`/Users/`・`sk-ant-` などの秘密らしい値が出ないこと
- 公開済みのリポジトリに足すときは、公開側の main が新しい HEAD の祖先であること（`git fetch <公開側の URL> main && git merge-base --is-ancestor FETCH_HEAD HEAD`）。ずれたら置き換えの違いを探し、--force で上書きしない

## 4. 押し上げる（開発者の了解のあと）

新しいリポジトリは、まず非公開で作る。名前と説明文は docs/submission.md の案を使い、変えるなら開発者に聞く。

```sh
gh repo create <owner>/<name> --private --description "<説明文>"
git push <新しいリポジトリの URL> HEAD:main
```

README を GitHub 上で読んで確かめたあと、開発者の了解を取って公開に切り替える（`gh repo edit <owner>/<name> --visibility public --accept-visibility-change-consequences`）。
