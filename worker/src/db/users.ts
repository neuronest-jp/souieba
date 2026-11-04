// users の upsert。認証を通った全リクエストで呼び、初回は行を作り、以後は last_seen_at を更新する。
export async function touchUser(db: D1Database, userId: string, now: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, display_name, created_at, last_seen_at) VALUES (?1, NULL, ?2, ?2)
       ON CONFLICT(id) DO UPDATE SET last_seen_at = ?2`,
    )
    .bind(userId, now)
    .run();
}
