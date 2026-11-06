// .vue の部品を描くテスト（*.dom.test.ts）の環境。Node のまま、モジュールはブラウザ向け（client）に変換する。
// 既定の node 環境では @vitejs/plugin-vue が SSR 向けに変換し、createRenderer で描けないため。
// DOM は持たない。描くのは fakeDom.ts の最小の DOM（jsdom などの依存を増やさない）
import type { Environment } from "vitest/runtime";

export default {
  name: "client-node",
  viteEnvironment: "client",
  setup: () => ({ teardown: () => {} }),
} satisfies Environment;
