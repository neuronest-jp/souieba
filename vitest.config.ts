import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  // 画面の部品（.vue）をテストで読めるようにする（*.dom.test.ts）
  plugins: [vue()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          // Worker と、画面側の DOM に依存しない部分（web/test。DOM が要る所は最小のスタブで代える）
          include: ["worker/test/**/*.test.ts", "web/test/**/*.test.ts"],
          exclude: ["web/test/**/*.dom.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          // 部品を描いて確かめる（フォーカスの置き先や読み上げの文字）。DOM は web/test/fakeDom.ts の最小のもの
          include: ["web/test/**/*.dom.test.ts"],
          environment: "./web/test/clientEnv.ts",
        },
      },
    ],
  },
});
