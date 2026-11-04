// POST /api/memories の保存後に走らせる AI 処理（architecture 6.6）。C1 と C2 は独立した waitUntil。
import type { AfterSave } from "../routes/memories";
import { beginFacts, runFacts, type FactsDeps } from "./facts";
import { beginRecall, runRecall, type RecallDeps } from "./recall";

export const aiAfterSave = (deps: { facts?: FactsDeps; recall?: RecallDeps } = {}): AfterSave =>
  async ({ env, userId, memory, waitUntil }) => {
    // 201 の前: running の記録を作る（画面の pending 判定に使う）。facts はすぐ waitUntil に渡し、recall の失敗に巻き込まれない。
    const factsRunId = await beginFacts(env, userId, memory, deps.facts);
    waitUntil(runFacts(env, factsRunId, memory, deps.facts));
    try {
      const recall = await beginRecall(env, userId, memory, deps.recall);
      if (recall) waitUntil(runRecall(env, recall.runId, memory, recall.past, deps.recall));
    } catch (e) {
      console.error("beginRecall failed", memory.id, e);
    }
  };
