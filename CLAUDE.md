# CLAUDE.md — そういえば。

Built with Claude: Japan 2026 ハッカソン向けの個人開発。提出 2026-11-10 14:00 JST。

## 最初に読む

- docs/spec.md（基本要件。第2節・第4節 P0・第13節・第14節を優先）
- docs/requirements.md → docs/architecture.md → docs/tasks.md

## スタック（変更不可）

Cloudflare Workers + Hono + D1 + R2、Workers Static Assets で Vue 3 + Vite + TypeScript + Tailwind の SPA を同一 Worker から配信。
認証は Cloudflare Access（メール OTP）。ローカルは `ENVIRONMENT=development` のときだけ `X-Dev-User`。
Anthropic API は `@anthropic-ai/sdk` を Worker から呼び、Structured Outputs（`output_config.format`）で JSON Schema を強制（ADR-0005。現行モデルは `tool_choice` 強制を拒否する）。モデル名は `ANTHROPIC_MODEL`（既定 `claude-opus-5-5`）。

## 守ること

- 仕様からの変更・重要な判断は docs/decisions/ に ADR を書き、開発者に一言報告する
- 期間前のコード、権利のない素材は持ち込まない。依存は必要最小限
- `.dev.vars` と `demo/photos/` には書き込まない（フックで拒否される）
- 製品原則: AI の推測を事実として確定しない / 関係なければ提案しない / 提案には必ず根拠（原文引用）
- UI は「テクノロジーを意識させない温かい記憶のアプリ」。AI チャット画面を中心にしない
- 動くことより先に、実際に使いたくなる UI/UX。ただし期間内に完成しない機能は提案しない

## コマンド

```sh
pnpm install
pnpm db:migrate:local   # D1（ローカル）
pnpm dev:worker         # Worker（http://localhost:8787）。development として起動し X-Dev-User を受け付ける
pnpm dev                # 画面（http://localhost:5173）。/api を 8787 に中継し X-Dev-User を付ける
pnpm preview            # 本番相当: 画面をビルドして Worker から配信（http://localhost:8787）
pnpm test               # vitest
pnpm typecheck
pnpm build              # 画面ビルド + wrangler deploy --dry-run
```

## 報告の形

各ステップの終わりに「作ったもの / 次にすること / 開発者の判断が必要なこと」を短く。
