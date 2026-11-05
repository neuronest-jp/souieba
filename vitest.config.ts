import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Worker と、画面側の DOM に依存しない部分（web/test。DOM が要る所は最小のスタブで代える）
    include: ["worker/test/**/*.test.ts", "web/test/**/*.test.ts"],
    environment: "node",
  },
});
