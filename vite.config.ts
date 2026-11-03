import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// 画面は web/ を Vite の root にし、web/dist に出す。Worker の [assets] がそこを配信する。
// 開発時は vite dev（5173）が /api を wrangler dev（8787）へ中継し、
// ローカル専用の X-Dev-User ヘッダを付ける（本番の Worker はこのヘッダを無視する）。
export default defineConfig({
  root: "web",
  plugins: [vue(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: false,
        headers: { "X-Dev-User": process.env.DEV_USER ?? "dev@example.com" },
      },
    },
  },
});
