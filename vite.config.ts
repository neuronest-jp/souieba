import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// 画面は web/ を Vite の root にし、web/dist に出す。Worker の [assets] がそこを配信する。
// 開発時は vite dev（5173）が /api を wrangler dev（8787）へ中継し、
// ローカル専用の X-Dev-User ヘッダを付ける（本番の Worker はこのヘッダを無視する）。
// ただし同じオリジン（この画面）からの要求にだけ付ける。ほかのサイトから localhost:5173/api へ送られた要求
// （no-cors の POST など）にまで付けると、開発ユーザーとして記憶を作られ、Claude の呼び出しも走るため（CWE-352）。
// ヘッダを外した要求は Worker で 401 になる。
type DevReq = { headers: Record<string, string | string[] | undefined> };
const fromThisPage = (req: DevReq): boolean => {
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string") return site === "same-origin" || site === "none";
  const origin = req.headers.origin;
  return origin === undefined || origin === `http://${String(req.headers.host)}`;
};

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
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (!fromThisPage(req)) proxyReq.removeHeader("X-Dev-User");
          });
        },
      },
    },
  },
});
