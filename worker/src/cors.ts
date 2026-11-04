// CORS（ADR-0007）。アプリの WebView と開発サーバだけを許す。Cookie は使わない。
import { cors } from "hono/cors";
import { isDevelopment, type Env } from "./env";

// iOS は capacitor://localhost、Android は https://localhost（androidScheme の既定）、開発は Vite の 5173
export const ALLOWED_ORIGINS = ["capacitor://localhost", "https://localhost", "http://localhost:5173"];

export const corsOptions = (env: Pick<Env, "ENVIRONMENT">) => ({
  origin: (origin: string) => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: isDevelopment(env) ? ["Authorization", "Content-Type", "X-Dev-User"] : ["Authorization", "Content-Type"],
  exposeHeaders: ["Retry-After"],
  maxAge: 600,
  credentials: false,
});

export const apiCors = () => {
  const handlers = new Map<string, ReturnType<typeof cors>>();
  return (async (c, next) => {
    const key = isDevelopment(c.env) ? "dev" : "prod";
    let h = handlers.get(key);
    if (!h) {
      h = cors(corsOptions(c.env));
      handlers.set(key, h);
    }
    return h(c, next);
  }) as import("hono").MiddlewareHandler<{ Bindings: Env }>;
};
