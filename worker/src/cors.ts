// CORS（ADR-0007）。アプリの WebView と開発サーバだけを許す。Cookie は使わない。
import { cors } from "hono/cors";

export const ALLOWED_ORIGINS = ["capacitor://localhost", "https://localhost", "http://localhost:5173", "http://localhost"];

export const apiCors = () =>
  cors({
    origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Dev-User"],
    exposeHeaders: [],
    maxAge: 600,
    credentials: false,
  });
