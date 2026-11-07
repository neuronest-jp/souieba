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
          reason: { type: "string", description: "なぜ思い出したか。書いた本人に添える、です・ます調のやわらかい日本語の一文（80 文字以内）" },
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

// ことばの地図（ADR-0014）。Claude は「その人の暮らしを形づくっている言葉」と、本文に出てくる形（surfaces）を選ぶだけ。
// 数（何年に何回）と引用は Worker が本文から数える（worker/src/keywords/count.ts）。件数（最大 40、surfaces 1〜3）は verify.ts で切る
export const KEYWORD_KINDS = ["person", "place", "thing", "event", "feeling"] as const;
export const KEYWORDS_SCHEMA = {
  type: "object",
  properties: {
    keywords: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "地図に出す短い言葉。本文に出てくる言葉のまま（言い換えない）" },
          kind: { type: "string", enum: KEYWORD_KINDS, description: "person は人、place は場所、thing はもの、event は出来事、feeling は本文に言葉として書かれた気持ち" },
          surfaces: {
            type: "array",
            items: { type: "string", description: "本文に出てくる形のまま。一字も変えない" },
            description: "この言葉が本文に出てくる形を 1〜3 個（例: そら / そらくん）",
          },
        },
        required: ["label", "kind", "surfaces"],
        additionalProperties: false,
      },
    },
  },
  required: ["keywords"],
  additionalProperties: false,
} as const;

export type RecallOutput = { items: Array<{ related_memory_id: string; reason: string; evidence: string }> };
export type FactsOutput = {
  items: Array<{ kind: "person" | "place" | "date" | "thing"; value: string; evidence: string; date_precision: "day" | "month" | "year" | "unknown" }>;
};
export type PhotoHintsOutput = { items: Array<{ kind: "thing" | "place"; value: string }> };
export type KeywordKind = (typeof KEYWORD_KINDS)[number];
export type KeywordsOutput = { keywords: Array<{ label: string; kind: KeywordKind; surfaces: string[] }> };
