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

export type MemoryDetail = {
  memory: Memory;
  facts: { pending: boolean; items: Fact[] };
  recalls: { pending: boolean; items: Recall[] };
  recalled_by: { items: RecalledBy[] };
};

export type MemoryList = { items: Memory[]; next_cursor: string | null };

export type NewMemory = { body: string; happened_on?: string; happened_on_precision: Precision };
