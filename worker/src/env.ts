// Worker のバインディングと環境変数。wrangler.toml の [vars] / [[d1_databases]] / [[r2_buckets]] と対応する。
export type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  ENVIRONMENT: "development" | "production" | string;
  ANTHROPIC_MODEL: string;
  ANTHROPIC_API_KEY?: string; // wrangler secret
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  APP_VERSION: string;
};

export type User = {
  id: string; // メールアドレス
};

export type Variables = {
  user: User;
};

export const isDevelopment = (env: Pick<Env, "ENVIRONMENT">): boolean =>
  env.ENVIRONMENT === "development";
