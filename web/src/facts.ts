// 取り直した事実（候補）の一覧に、画面で決めた印を重ねる。S1 の保存直後のポーリングと S1 に戻ったときの取り直し、S3 の取り直しで使う。
// 「そう / ちがう」は一方通行（候補 → 確定 / 却下。取り消しは作らない。wireframes 8 #6）なので、
// 画面で決めてあればその行（オブジェクトごと）を残し、画面がまだ候補なら取り直した側（ほかの画面で決めた分を含む）を使う。
// 決めた行を同じオブジェクトのまま残すのは、記録に失敗したとき FactChips が印を戻す先を見失わないようにするため。
import type { Fact } from "./api/types";

export const keepDecided = (shown: Fact[], fetched: Fact[]): Fact[] => {
  const byId = new Map(shown.map((f) => [f.id, f]));
  return fetched.map((f) => {
    const mine = byId.get(f.id);
    return mine && mine.status !== "candidate" ? mine : f;
  });
};
