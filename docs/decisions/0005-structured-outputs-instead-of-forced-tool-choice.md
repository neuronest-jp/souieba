# ADR-0005: JSON Schema の強制は tool_choice 強制ではなく Structured Outputs で行う

- 日付: 2026-11-03
- 状態: 採用

## 背景

依頼文と仕様書 第9節は「tool use による JSON Schema 強制出力（`tool_choice: {type: "tool", name}`）」としている。
しかし Claude API の現行仕様では、Claude Opus 5.5 / Claude Sonnet 5.5（および Fable 5.1）は
`tool_choice` の `any` / `tool` を 400 で拒否する（`tool_choice: type "tool" and "any" are not supported for this model.`）。
強制 tool_choice を使うには1世代前のモデル（Claude Opus 5 / Claude Sonnet 5）に固定する必要がある。

## 決定

- 出力の形は Messages API の Structured Outputs（`output_config: { format: { type: "json_schema", schema } }`）で固定する。
  目的（スキーマどおりの JSON を確実に受け取る）は同じで、現行モデルで動く。
- スキーマは `additionalProperties: false` を全オブジェクトに付けた素の JSON Schema で書く（Zod は入れない。依存最小限）。
  `minLength` 等の数値・文字列制約は API 側で無視されるため、件数上限（最大3件）や引用の実在は Worker 側で検証する（原則3の検証は元々 Worker 側）。
- 既定モデルは `claude-opus-5-5`。環境変数 `ANTHROPIC_MODEL` で `claude-sonnet-5-5` に切り替えられる（ADR-0003 の既定値を更新）。
  理由: 想起の「関係がなければ出さない」判断の質が製品の核であり、Opus 5.5 は Sonnet 5.5 の2倍の単価だが1記憶あたりの呼び出しは2〜3回で総額は小さい。
- thinking は省略（既定の adaptive）。`output_config.effort` は `medium` から始め、11/6 のデモ通しで調整する。
- 安全分類による `stop_reason: "refusal"` が返る可能性があるため、想起と候補抽出では refusal を「0件」として扱い、`ai_runs.status = failed` に理由を残す。

## 影響

- docs/spec.md 第9節・第12節の「tool use による強制」は「Structured Outputs による強制」と読み替える（原本到着後に本 ADR を添えて差し替えを提案）
- docs/architecture.md の AI 呼び出し節は本 ADR に従う
- wrangler.toml の `ANTHROPIC_MODEL` 既定値を `claude-opus-5-5` にする
