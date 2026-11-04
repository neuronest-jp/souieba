// テスト用: Node 標準の node:sqlite で D1Database の最小互換を作る。
// マイグレーション（worker/migrations/*.sql）を順に流すので、SQL は本物のスキーマに対して検証される。
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "..", "migrations");

export type TestD1 = D1Database & { raw: DatabaseSync };

export function createTestD1(): TestD1 {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  }

  // D1 は ?1 ?2 の番号付きプレースホルダを使う。node:sqlite も同じ記法を受け付ける。
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind: (...a: unknown[]) => {
        // 本物の D1 は undefined を受け付けない（D1_TYPE_ERROR）。テストでも同じく失敗させる。
        if (a.some((v) => v === undefined)) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
        args = a;
        return stmt;
      },
      run: async () => {
        const r = raw.prepare(sql).run(...(args as never[]));
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) }, results: [] };
      },
      first: async <T>(col?: string) => {
        const row = raw.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined;
        if (!row) return null;
        if (col !== undefined && !(col in row)) throw new Error(`D1_COLUMN_NOTFOUND: ${col}`);
        return (col ? row[col] : { ...row }) as T;
      },
      all: async <T>() => {
        const rows = raw.prepare(sql).all(...(args as never[])) as Record<string, unknown>[];
        return { results: rows.map((r) => ({ ...r })) as T[], success: true, meta: {} };
      },
    };
    return stmt;
  };

  const batch = async (stmts: Array<ReturnType<typeof prepare>>) => {
    const out = [];
    raw.exec("BEGIN");
    try {
      for (const s of stmts) out.push(await s.run());
      raw.exec("COMMIT");
    } catch (e) {
      raw.exec("ROLLBACK");
      throw e;
    }
    return out;
  };

  return { prepare, batch, raw, exec: async (q: string) => (raw.exec(q), { count: 0, duration: 0 }) } as unknown as TestD1;
}

// R2 の最小スタブ。put / get / delete だけ。
export const fakeR2 = () => {
  const store = new Map<string, { body: Uint8Array; contentType: string | null }>();
  return {
    store,
    put: async (key: string, body: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => {
      store.set(key, { body: body instanceof Uint8Array ? body : new Uint8Array(body), contentType: opts?.httpMetadata?.contentType ?? null });
      return { key };
    },
    get: async (key: string) => {
      const v = store.get(key);
      if (!v) return null;
      return { key, body: new Blob([v.body]).stream(), httpMetadata: { contentType: v.contentType ?? undefined }, size: v.body.byteLength };
    },
    delete: async (key: string | string[]) => {
      for (const k of Array.isArray(key) ? key : [key]) store.delete(k);
    },
  } as unknown as R2Bucket & { store: typeof store };
};

// ExecutionContext の最小スタブ。waitUntil に渡された Promise を集め、テストから待てるようにする。
export const fakeExecutionCtx = () => {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
    settle: () => Promise.allSettled(pending),
  } as unknown as ExecutionContext & { pending: Promise<unknown>[]; settle: () => Promise<unknown> };
};
