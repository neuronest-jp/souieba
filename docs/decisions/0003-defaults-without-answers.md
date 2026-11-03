# ADR-0003: 未回答の確認事項に対する既定値

- 日付: 2026-11-03
- 状態: 採用（開発者の回答があれば上書き）

開発者への確認事項のうち回答がなかった項目は、次の既定値で進める。

| 項目 | 既定値 | 理由 |
|---|---|---|
| デプロイ実行主体 | 開発者の手元（Claude Code 環境に Cloudflare 認証がない） | 手順を docs/setup-cloudflare.md に用意。Claude Code は `wrangler deploy --dry-run` まで検証 |
| D1 名 | `souieba` | 旧 `yui` と混同しない |
| R2 バケット名 | `souieba-photos` | 用途が名前から分かる |
| Worker 名 | `souieba` | |
| モデル名 | `ANTHROPIC_MODEL` 既定 `claude-sonnet-5-5`。上位切替候補 `claude-opus-5-5` | 想起の品質とコストの両立。環境変数で切替 |
| リポジトリ名 | `yui` のまま | リネームは GitHub 側の操作が必要 |
| ブランチ運用 | `claude/souieba-setup-ukc5pw` に push、PR は作らない | 開発者が main にマージ |
| ローカル認証 | `ENVIRONMENT=development` のときのみ `X-Dev-User` を受理 | 本番では無視 |
| 書き込み禁止フック | PreToolUse（Write/Edit/MultiEdit/Bash）で `.dev.vars` と `demo/photos/` を拒否 | |
| カラー / フォント | docs/architecture.md の「デザイン基盤」を参照（ADR-0004） | |
