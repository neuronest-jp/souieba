// 写真。PUT /api/memories/:id/photo（multipart、フィールド名 photo）と GET /api/photos/*。
// requirements F2-5〜F2-8、architecture 5.7 / 5.8。
import { Hono } from "hono";
import type { PhotoInfo } from "../ai/photo";
import { getMemory, type MemoryRow } from "../db/memories";
import type { Env, Variables } from "../env";
import { ApiError } from "../errors";

export const PHOTO_MAX_BYTES = 10_485_760;
export const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };

/** ログに出す写真のキー。2 つめの区切り（メールアドレス）を伏せる。photos/<user>/<記憶の ID>/<ファイル名> の形 */
export const maskPhotoKey = (key: string): string => key.replace(/^photos\/[^/]+\//, "photos/<user>/");

export const photoKeyFor = (userId: string, memoryId: string, ext: string) =>
  `photos/${userId}/${memoryId}/${crypto.randomUUID()}.${ext}`;

// 中身の先頭バイトで JPEG / PNG を確かめる（Content-Type の申告だけを信じない）
export const sniffImageType = (bytes: Uint8Array): "image/jpeg" | "image/png" | null => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
};

// 写真を保存したあとの AI 処理（C3 写真からの気づき候補、requirements F7）の起動口。200 の前に呼ぶ
export type AfterPhoto = (args: {
  env: Env;
  userId: string;
  memory: MemoryRow;
  photo: PhotoInfo;
  waitUntil: (p: Promise<unknown>) => void;
}) => Promise<void>;
export const noAfterPhoto: AfterPhoto = async () => {};

export type PhotosDeps = { afterPhoto?: AfterPhoto };

export const putPhotoRoute = (deps: PhotosDeps = {}) => {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  const afterPhoto = deps.afterPhoto ?? noAfterPhoto;

  app.put("/:id/photo", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const memory = await getMemory(c.env.DB, user.id, id);
    if (!memory) throw new ApiError(404, "not_found", "見つかりません");

    // Content-Length で先に大きさを見る（本文を読む前に 413 を返す）
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > PHOTO_MAX_BYTES + 4096) throw new ApiError(413, "too_large", "写真が大きすぎるみたいです（10MB まで）");

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw new ApiError(400, "validation", "写真の送り方が違います");
    }
    const file = form.get("photo");
    if (!(file instanceof File)) throw new ApiError(400, "validation", "photo がありません");
    if (file.size > PHOTO_MAX_BYTES) throw new ApiError(413, "too_large", "写真が大きすぎるみたいです（10MB まで）");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffImageType(bytes);
    if (!type || (file.type && file.type !== type && file.type in PHOTO_TYPES)) {
      throw new ApiError(415, "unsupported_media", "JPEG か PNG の写真だけ添えられます");
    }
    const ext = PHOTO_TYPES[type] ?? "jpg";
    const key = photoKeyFor(user.id, id, ext);
    await c.env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } });

    const now = new Date().toISOString();
    await c.env.DB.prepare("UPDATE memories SET photo_key = ?1, photo_content_type = ?2, updated_at = ?3 WHERE id = ?4 AND user_id = ?5")
      .bind(key, type, now, id, user.id)
      .run();

    // 前の写真は差し替え後に消す（失敗しても続行）
    if (memory.photo_key && memory.photo_key !== key) {
      try {
        await c.env.PHOTOS.delete(memory.photo_key);
      } catch (e) {
        // キーの 2 つめの区切りはメールアドレスなので伏せる（ログに個人の識別子を出さない。ADR-0013）
        console.error("old photo delete failed", maskPhotoKey(memory.photo_key), e instanceof Error ? e.message : String(e));
      }
    }
    // 200 を返す前に写真候補の記録（running）を作る（afterPhoto 側の責務。waitUntil で続きを走らせる）。
    // ここで失敗しても写真は保存済みなので 200 を返す。AI は「静かな失敗」（architecture 6.6）
    try {
      await afterPhoto({
        env: c.env,
        userId: user.id,
        memory,
        photo: { key, contentType: type, size: bytes.byteLength },
        waitUntil: (p) => c.executionCtx.waitUntil(p),
      });
    } catch (e) {
      console.error("afterPhoto failed", id, e);
    }
    return c.json({ photo_key: key, photo_content_type: type });
  });

  return app;
};

export const getPhotoRoute = () => {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.get("/*", async (c) => {
    const user = c.get("user");
    const key = c.req.path.replace(/^\/api\/photos\//, "");
    const prefix = `photos/${user.id}/`;
    if (!key.startsWith(prefix) || key.includes("..")) throw new ApiError(404, "not_found", "見つかりません");
    const obj = await c.env.PHOTOS.get(key);
    if (!obj) throw new ApiError(404, "not_found", "見つかりません");
    return new Response(obj.body, {
      headers: {
        "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
        "cache-control": "private, max-age=3600",
        "content-length": String(obj.size),
      },
    });
  });

  return app;
};
