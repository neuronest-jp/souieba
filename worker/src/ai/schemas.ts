// Structured Outputs の JSON Schema（architecture 6.2 / 6.3、ADR-0005）。全オブジェクトに additionalProperties: false。
// maxItems などの数値制約は API 側で保証されないため、件数は Worker の検証（verify.ts）で切る。

export const RECALL_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          related_memory_id: { type: "string", description: "関係のある過去の記憶の id（入力に含まれるものだけ）" },
          reason: { type: "string", description: "なぜ関係があるか。日本語で 80 文字以内の一文" },
          evidence: { type: "string", description: "その過去の記憶の本文からの逐語引用。一字も変えない" },
        },
        required: ["related_memory_id", "reason", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

export const FACTS_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["person", "place", "date", "thing"] },
          value: { type: "string", description: "候補の値。date は YYYY-MM-DD / YYYY-MM / YYYY" },
          evidence: { type: "string", description: "本文からの逐語引用。一字も変えない" },
          date_precision: { type: "string", enum: ["day", "month", "year", "unknown"], description: "kind が date のときの精度。他は unknown" },
        },
        required: ["kind", "value", "evidence", "date_precision"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

// C3 写真からの気づき候補（requirements F7）。kind は写っている物事（thing）と場所の種類（place）だけ。
// 人物（person）と日付（date）は写真からは出さない（enum で外し、Worker でも kind で捨てる）。件数（最大 5）は verify.ts で切る。
export const PHOTO_HINTS_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["thing", "place"], description: "thing は写っている物事（季節の「桜」「紅葉」「雪」もここ）、place は場所の種類" },
          value: { type: "string", description: "短い日本語の名詞（例: 桜、紅葉、公園、海辺）。語尾や説明は付けない" },
        },
        required: ["kind", "value"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

export type RecallOutput = { items: Array<{ related_memory_id: string; reason: string; evidence: string }> };
export type FactsOutput = {
  items: Array<{ kind: "person" | "place" | "date" | "thing"; value: string; evidence: string; date_precision: "day" | "month" | "year" | "unknown" }>;
};
export type PhotoHintsOutput = { items: Array<{ kind: "thing" | "place"; value: string }> };
