// shrinkPhoto（requirements F2-10）。DOM の依存は Image / canvas / URL だけなので、最小のスタブで node 上で検査する。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHOTO_MAX_EDGE, shrinkPhoto } from "../src/photo";

type Size = { w: number; h: number } | "error";
type CanvasStub = { width: number; height: number; drawn: boolean; quality?: number; type?: string };

let nextImage: Size;
let ctxAvailable: boolean;
let toBlobResult: "blob" | "null";
let canvases: CanvasStub[];
let revoked: string[];

class FakeImage {
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_url: string) {
    queueMicrotask(() => {
      if (nextImage === "error") return this.onerror?.();
      this.naturalWidth = nextImage.w;
      this.naturalHeight = nextImage.h;
      this.onload?.();
    });
  }
}

beforeEach(() => {
  nextImage = { w: 100, h: 100 };
  ctxAvailable = true;
  toBlobResult = "blob";
  canvases = [];
  revoked = [];
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("URL", { createObjectURL: () => "blob:fake", revokeObjectURL: (u: string) => revoked.push(u) });
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`unexpected ${tag}`);
      const c: CanvasStub & { getContext: () => unknown; toBlob: (cb: (b: Blob | null) => void, type: string, q: number) => void } = {
        width: 0,
        height: 0,
        drawn: false,
        getContext: () => (ctxAvailable ? { drawImage: () => (c.drawn = true) } : null),
        toBlob: (cb, type, q) => {
          c.type = type;
          c.quality = q;
          cb(toBlobResult === "blob" ? new Blob(["x"], { type }) : null);
        },
      };
      canvases.push(c);
      return c;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const file = (type: string, size: number) => new File([new Uint8Array(size)], "p", { type });

describe("shrinkPhoto", () => {
  it("横長 4000×3000 は長辺 1600 に縮め、JPEG 0.85 で出す", async () => {
    nextImage = { w: 4000, h: 3000 };
    const out = await shrinkPhoto(file("image/png", 10));
    expect(canvases).toHaveLength(1);
    expect(canvases[0]).toMatchObject({ width: PHOTO_MAX_EDGE, height: 1200, drawn: true, type: "image/jpeg", quality: 0.85 });
    expect(out.type).toBe("image/jpeg");
    expect(revoked).toEqual(["blob:fake"]); // 読み込みに使った URL は返却する
  });

  it("縦長でも長辺（高さ）で縮める", async () => {
    nextImage = { w: 1000, h: 3200 };
    await shrinkPhoto(file("image/jpeg", 10));
    expect(canvases[0]).toMatchObject({ width: 500, height: 1600 });
  });

  it("小さい JPEG（1600px 以下かつ 2MB 未満）はそのまま返す", async () => {
    nextImage = { w: 1200, h: 900 };
    const f = file("image/jpeg", 1000);
    expect(await shrinkPhoto(f)).toBe(f);
    expect(canvases).toHaveLength(0);
  });

  it("小さくても PNG は JPEG に描き直す（拡大はしない）", async () => {
    nextImage = { w: 800, h: 600 };
    await shrinkPhoto(file("image/png", 1000));
    expect(canvases[0]).toMatchObject({ width: 800, height: 600 });
  });

  it("読めない画像・寸法 0・Canvas が無い・toBlob が null のときは元のファイル", async () => {
    const f = file("image/png", 10);
    nextImage = "error";
    expect(await shrinkPhoto(f)).toBe(f);
    nextImage = { w: 0, h: 0 };
    expect(await shrinkPhoto(f)).toBe(f);
    nextImage = { w: 4000, h: 3000 };
    ctxAvailable = false;
    expect(await shrinkPhoto(f)).toBe(f);
    ctxAvailable = true;
    toBlobResult = "null";
    expect(await shrinkPhoto(f)).toBe(f);
  });
});
