# CLAUDE.md — そういえば。

Built with Claude: Japan 2026 ハッカソン向けの個人開発。提出締切は 2026-11-08（日）20:00 JST（第 1 ラウンドの審査が 11/9、最終審査は 11/10 13:00〜14:30）。提出物と審査基準は docs/submission.md。

## 最初に読む

- docs/spec.md（基本要件。第2節・第4節 P0・第13節・第14節を優先）
- docs/requirements.md → docs/architecture.md → docs/tasks.md

## スタック（変更不可）

API は Cloudflare Workers + Hono + D1 + R2。アプリは Capacitor（iOS / Android）の WebView で Vue 3 + Vite + TypeScript + Tailwind を動かす（appId `jp.neuronest.souieba`、webDir `web/dist`、`ios/` と `android/` はコミット）。Workers Static Assets の配信は開発用プレビューだけ（ADR-0007）。
認証は招待コード + メールアドレス → HS256 JWT（有効 90 日）。`POST /api/auth/login` が `INVITE_CODE`（wrangler secret。`コード=メール[,…]` の対応表で 1 人 1 つ。`=` の無い `dev` は development だけ全メール可）の全行と定数時間比較し、`JWT_SECRET`（wrangler secret）で署名。アプリは `@capacitor/preferences` に保持して `Authorization: Bearer` で送り、401 で消してログイン画面へ。ローカルは `ENVIRONMENT=development` のときだけ `X-Dev-User` も可。CORS は worker/src/cors.ts に固定。
Anthropic API は `@anthropic-ai/sdk` を Worker から呼び、Structured Outputs（`output_config.format`）で JSON Schema を強制（ADR-0005。現行モデルは `tool_choice` 強制を拒否する）。モデル名は `ANTHROPIC_MODEL`（既定 `claude-opus-5-5`）。

## 守ること

- 仕様からの変更・重要な判断は docs/decisions/ に ADR を書き、開発者に一言報告する
- 期間前のコード、権利のない素材は持ち込まない。依存は必要最小限
- `.dev.vars` と `demo/photos/`、`ios/` `android/` 配下の署名ファイル（`*.mobileprovision`、`*.p12`、`*.keystore`、`key.properties`、`google-services.json`、`GoogleService-Info.plist` など）には書き込まない（フックで拒否される）
- `INVITE_CODE` と `JWT_SECRET` の本番の値をコード・文書・チャットに書かない（`dev` / `dev-only-secret` は開発専用の既定値）
- 製品原則: AI の推測を事実として確定しない / 関係なければ提案しない / 提案には必ず根拠（原文引用）
- UI は「テクノロジーを意識させない温かい記憶のアプリ」。AI チャット画面を中心にしない
- 動くことより先に、実際に使いたくなる UI/UX。ただし期間内に完成しない機能は提案しない

## コマンド

```sh
pnpm install
pnpm db:migrate:local   # D1（ローカル）
pnpm dev:worker         # Worker（http://localhost:8787）。development として起動し X-Dev-User を受け付ける。招待コードは開発専用の dev
pnpm dev:worker:lan     # 実機から叩くとき。LAN の IP だけで待ち受け、本番と同じ認証（X-Dev-User 無効）、招待コードは乱数で `LAN_EMAIL` に結びつく（docs/setup-capacitor.md 1.1）。dev:worker を LAN に出さない
pnpm dev                # 画面（http://localhost:5173）。/api を 8787 に中継し X-Dev-User を付ける
pnpm preview            # 本番相当: 画面をビルドして Worker から配信（http://localhost:8787）。ログイン画面に dev とメールで入る
pnpm test               # vitest
pnpm typecheck
pnpm check:words        # 画面の禁止語（AI / 生成 / 送信）と色リテラルの検査（CI でも実行）
pnpm build              # 画面ビルド + wrangler deploy --dry-run
pnpm cap:sync           # 画面ビルド + cap sync（ios/ android/ に web/dist を同期。VITE_API_BASE は web/.env.* で）
pnpm cap:ios            # cap:sync + Xcode を開く（Mac）
pnpm cap:android        # cap:sync + Android Studio を開く（Mac）
```

クラウド（Linux）のセッションでは iOS / Android のビルドと実機確認はできない。開発者の Mac のセッションでは Xcode で実機まで通る（docs/handoff-2026-11-05.md 8 節）。手順は docs/setup-capacitor.md。
Mac で旧構成の checkout の中に worktree を置いている間は、`pnpm install --ignore-workspace` で入れる（親の `pnpm-workspace.yaml` に吸われるため）。

## 報告の形

各ステップの終わりに「作ったもの / 次にすること / 開発者の判断が必要なこと」を短く。
