import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/index";
import { DEV_USER_HEADER } from "../src/auth";
import type { Env } from "../src/env";
import { PHOTO_MAX_BYTES, sniffImageType } from "../src/routes/photos";
import { createTestD1, fakeR2, type TestD1 } from "./sqlite-d1";

const ME = "hana@example.com";
const OTHER = "other@example.com";
let db: TestD1;
let env: Env;
let r2: ReturnType<typeof fakeR2>;
const app = () => createApp();
const H = { [DEV_USER_HEADER]: ME };

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const GIF = new TextEncoder().encode("GIF89a........");

const createMemory = async (headers = H) => {
  const res = await app().request(
    "/api/memories",
    { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ body: "写真つき" }) },
    env,
  );
  return (await res.json()) as { id: string };
};

const putPhoto = (id: string, bytes: Uint8Array, type: string, headers = H) => {
  const form = new FormData();
  form.set("photo", new File([bytes], "p", { type }));
  return app().request(`/api/memories/${id}/photo`, { method: "PUT", headers, body: form }, env);
};

beforeEach(() => {
  db = createTestD1();
  r2 = fakeR2();
  env = { DB: db, PHOTOS: r2, ASSETS: {} as Fetcher, ENVIRONMENT: "development", ANTHROPIC_MODEL: "m", APP_VERSION: "test" } as Env;
});

describe("sniffImageType", () => {
  it("先頭バイトで判定する", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(GIF)).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });
});

describe("PUT /api/memories/:id/photo", () => {
  it("F2-5: JPEG を保存し、GET /api/photos/:key が同じバイト列を返す", async () => {
    const { id } = await createMemory();
    const res = await putPhoto(id, JPEG, "image/jpeg");
    expect(res.status).toBe(200);
    const { photo_key, photo_content_type } = (await res.json()) as { photo_key: string; photo_content_type: string };
    expect(photo_key).toMatch(new RegExp(`^photos/${ME}/${id}/[0-9a-f-]+\\.jpg$`));
    expect(photo_content_type).toBe("image/jpeg");
    expect(db.raw.prepare("SELECT photo_key, photo_content_type FROM memories WHERE id = ?").get(id)).toEqual({ photo_key, photo_content_type: "image/jpeg" });

    const get = await app().request(`/api/photos/${photo_key}`, { headers: H }, env);
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/jpeg");
    expect(get.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(JPEG);
  });

  it("PNG も受け付ける。申告の type が中身と違えば 415", async () => {
    const { id } = await createMemory();
    expect((await putPhoto(id, PNG, "image/png")).status).toBe(200);
    expect((await putPhoto(id, PNG, "image/jpeg")).status).toBe(415);
  });

  it("F2-7: GIF は 415、R2 に書かれない", async () => {
    const { id } = await createMemory();
    const res = await putPhoto(id, GIF, "image/gif");
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: { code: "unsupported_media" } });
    expect(r2.store.size).toBe(0);
  });

  it("F2-6: 10,485,761 バイトは 413、R2 に書かれない", async () => {
    const { id } = await createMemory();
    const big = new Uint8Array(PHOTO_MAX_BYTES + 1);
    big.set(PNG);
    const res = await putPhoto(id, big, "image/png");
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: "too_large" } });
    expect(r2.store.size).toBe(0);
  });

  it("F2-8: 他人の記憶には 404", async () => {
    const { id } = await createMemory();
    expect((await putPhoto(id, JPEG, "image/jpeg", { [DEV_USER_HEADER]: OTHER })).status).toBe(404);
  });

  it("photo フィールドが無ければ 400", async () => {
    const { id } = await createMemory();
    const form = new FormData();
    form.set("other", "x");
    const res = await app().request(`/api/memories/${id}/photo`, { method: "PUT", headers: H, body: form }, env);
    expect(res.status).toBe(400);
  });

  it("差し替えると前の写真は R2 から消える", async () => {
    const { id } = await createMemory();
    const first = (await (await putPhoto(id, JPEG, "image/jpeg")).json()) as { photo_key: string };
    const second = (await (await putPhoto(id, PNG, "image/png")).json()) as { photo_key: string };
    expect(r2.store.has(first.photo_key)).toBe(false);
    expect(r2.store.has(second.photo_key)).toBe(true);
    expect((await app().request(`/api/photos/${first.photo_key}`, { headers: H }, env)).status).toBe(404);
  });

  it("F3-4: 記憶を消すと写真も消える", async () => {
    const { id } = await createMemory();
    const { photo_key } = (await (await putPhoto(id, JPEG, "image/jpeg")).json()) as { photo_key: string };
    expect((await app().request(`/api/memories/${id}`, { method: "DELETE", headers: H }, env)).status).toBe(204);
    expect(r2.store.has(photo_key)).toBe(false);
  });
});

describe("GET /api/photos/*", () => {
  it("他人の写真は鍵を知っていても 404", async () => {
    const { id } = await createMemory();
    const { photo_key } = (await (await putPhoto(id, JPEG, "image/jpeg")).json()) as { photo_key: string };
    const res = await app().request(`/api/photos/${photo_key}`, { headers: { [DEV_USER_HEADER]: OTHER } }, env);
    expect(res.status).toBe(404);
  });
  it("自分の prefix でも無い鍵は 404。.. は拒否", async () => {
    expect((await app().request(`/api/photos/photos/${ME}/x/y.jpg`, { headers: H }, env)).status).toBe(404);
    expect((await app().request(`/api/photos/photos/${ME}/../${OTHER}/y.jpg`, { headers: H }, env)).status).toBe(404);
  });
});
