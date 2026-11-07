// Worker の API の型（docs/architecture.md 5 章、tasks J-7）。
export type Precision = "day" | "month" | "year" | "unknown";

export type Memory = {
  id: string;
  body: string;
  happened_on: string | null;
  happened_on_precision: Precision;
  photo_key: string | null;
  photo_content_type: string | null;
  created_at: string;
  updated_at: string;
};

export type MemorySummary = Pick<Memory, "id" | "body" | "happened_on" | "happened_on_precision" | "photo_key">;

export type Fact = {
  id: string;
  kind: "person" | "place" | "date" | "thing";
  value: string;
  status: "candidate" | "confirmed" | "rejected";
  source: "user" | "ai";
  evidence: string | null;
  created_at: string;
  decided_at: string | null;
};

export type Recall = {
  id: string;
  reason: string;
  evidence: string;
  feedback: "none" | "helpful" | "not_related";
  created_at: string;
  related_memory: MemorySummary; // 昔の記憶（この記憶を書いたとき浮かんだ相手）
};

export type RecalledBy = Omit<Recall, "related_memory"> & {
  memory: MemorySummary; // 新しい記憶（この記憶を思い出した側）
};

// つながり（GET /api/connections）。一組 = 一本の糸。memory が書いたひとこと（新しい側）、related_memory が思い出した昔のひとこと。
// API は not_related を返さないので feedback は none / helpful だけ（画面の中で反応を変えた後の状態は、画面側で別に持つ）
export type Connection = Recall & {
  feedback: "none" | "helpful";
  memory: MemorySummary;
};

// 糸の帯の粒。起きた日がわかっている自分の記憶の日付だけ（unknown は入らない）
export type Bead = {
  happened_on: string;
  happened_on_precision: Exclude<Precision, "unknown">;
};

export type ConnectionsResponse = { items: Connection[]; beads: Bead[] };

export type MemoryDetail = {
  memory: Memory;
  facts: { pending: boolean; items: Fact[] };
  recalls: { pending: boolean; items: Recall[] };
  recalled_by: { items: RecalledBy[] };
};

export type MemoryList = { items: Memory[]; next_cursor: string | null };

// 年月で探す（S2。ADR-0015）。GET /api/memories/months の形と、GET /api/memories の始まり（month= / year= / undated=1）。
// months は精度 day と month の年月（YYYY-MM）、years_only は精度 year の年（YYYY）、undated は日付なし。どれも新しい順
export type MemoryMonths = {
  months: Array<{ month: string; count: number }>;
  years_only: Array<{ year: string; count: number }>;
  undated: number;
};
export type ListStart = { month: string } | { year: string } | { undated: true };

export type NewMemory = { body: string; happened_on?: string; happened_on_precision: Precision };

// きょう（GET /api/today）。S1 の「このごろ」（きょうを右端にした 7 日。古い順）と「あの日のひとこと」と記憶の総数。日付は Asia/Tokyo
export type TodayDay = { date: string; wrote: boolean };

// あの日のひとこと: 去年以前の同じ日付のあたりの記憶（無い日は null）。
// match は day = 同じ月日、near = 前後 3 日、month = 同じ月（日の候補が無いとき）。years は何年まえか（1 以上）
export type ThatDay = { memory: MemorySummary; years: number; match: "day" | "near" | "month" };

export type TodayResponse = { today: string; week: TodayDay[]; that_day: ThatDay | null; total: number };
