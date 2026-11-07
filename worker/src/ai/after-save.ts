// POST /api/memories の保存後に走らせる AI 処理（architecture 6.6）。C1 と C2 は独立した waitUntil。
import type { AfterSave } from "../routes/memories";
import type { AfterPhoto } from "../routes/photos";
import { beginFacts, runFacts, type FactsDeps } from "./facts";
import { beginPhoto, runPhoto, type PhotoDeps } from "./photo";
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

// PUT /api/memories/:id/photo の保存後に走らせる C3（requirements F7）。上限内で、この記憶に photo の記録がまだ無いときだけ。
// running は 200 の前に作り（GET /facts の pending に入る）、続きは waitUntil で 1 回だけ
export const aiAfterPhoto = (deps: PhotoDeps = {}): AfterPhoto =>
  async ({ env, userId, memory, photo, waitUntil }) => {
    const runId = await beginPhoto(env, userId, memory.id, photo, deps);
    if (runId) waitUntil(runPhoto(env, runId, memory, photo, deps));
  };
