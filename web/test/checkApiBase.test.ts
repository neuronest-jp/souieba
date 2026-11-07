// scripts/check-api-base.mjs（cap:sync の先頭で走る向き先の見張り）を、一時ディレクトリに置いた web/.env.* と環境変数で実際に走らせて確かめる。
// 読む順は vite build と同じ（環境変数 → .env.production.local → .env.production → .env.local → .env）
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/check-api-base.mjs");

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "check-api-base-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const files = (map: Record<string, string>) => {
  for (const [name, body] of Object.entries(map)) writeFileSync(join(dir, name), body);
};
// env に VITE_API_BASE を渡さなければ、走らせる側の環境に入っていても外す
const run = (env: { VITE_API_BASE?: string } = {}) => {
  const base = { ...process.env };
  delete base.VITE_API_BASE;
  const r = spawnSync(process.execPath, [SCRIPT, dir], { env: { ...base, ...env }, encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr };
};

describe("止める（exit 1）", () => {
  it("どこにも書いていない", () => {
    const r = run();
    expect(r.status).toBe(1);
    expect(r.err).toContain("空");
  });

  it("より強いファイルに空で書いてあれば、弱いファイルの https より空が勝つ（vite と同じ）", () => {
    files({ ".env.production": "VITE_API_BASE=https://api.example.jp\n", ".env.production.local": "VITE_API_BASE=\n" });
    expect(run().status).toBe(1);
  });

  it("環境変数が空なら、ファイルの https より空が勝つ", () => {
    files({ ".env.production": "VITE_API_BASE=https://api.example.jp\n" });
    expect(run({ VITE_API_BASE: "" }).status).toBe(1);
  });

  it("http:// の公開ホスト、URL でない値、172.32.* は止める", () => {
    for (const v of ["http://api.example.jp", "api.example.jp", "ftp://192.168.0.2", "http://172.32.0.1:8787"]) {
      const r = run({ VITE_API_BASE: v });
      expect([v, r.status]).toEqual([v, 1]);
      expect(r.err).toContain(v); // 値はそのまま出す（秘密ではない）
    }
  });
});

describe("続ける（exit 0）", () => {
  it("https はそのまま続ける。.env.production が .env.local の LAN の向き先より勝つ", () => {
    files({ ".env.local": "VITE_API_BASE=http://192.168.1.20:8787\n", ".env.production": "VITE_API_BASE=https://api.example.jp\n" });
    const r = run();
    expect(r.status).toBe(0);
    expect(r.out).toContain("VITE_API_BASE=https://api.example.jp");
    expect(r.out).not.toContain("開発用の向き先");
  });

  it("環境変数の LAN の IP はファイルより勝ち、「開発用の向き先」と 1 行出して続ける", () => {
    files({ ".env.production": "VITE_API_BASE=https://api.example.jp\n" });
    const r = run({ VITE_API_BASE: "http://10.0.2.2:8787" });
    expect(r.status).toBe(0);
    expect(r.out.trim().split("\n")).toHaveLength(1);
    expect(r.out).toContain("開発用の向き先");
    expect(r.out).toContain("http://10.0.2.2:8787");
  });

  it("localhost・172.16-31.*・192.168.* と、.env しか無いときも読む", () => {
    for (const v of ["http://localhost:8787", "http://127.0.0.1:8787", "http://172.20.1.2:8787", "http://192.168.0.9:8787"]) {
      const r = run({ VITE_API_BASE: v });
      expect([v, r.status, r.out.includes("開発用の向き先")]).toEqual([v, 0, true]);
    }
    files({ ".env": "# コメント\nexport VITE_API_BASE = \"https://api.example.jp\"  # 行末のコメント\n" });
    const r = run();
    expect(r.status).toBe(0);
    expect(r.out).toContain("VITE_API_BASE=https://api.example.jp（");
  });
});
