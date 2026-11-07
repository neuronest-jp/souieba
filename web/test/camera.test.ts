// 写真の取得（camera.ts）。11/7 の実機で「写真を添える」を押しても何も起きなかった件の再発を防ぐ。
// 原因は Info.plist に NSPhotoLibraryAddUsageDescription が無く、@capacitor/camera の iOS が選択肢を出す前に断り、
// その断りを pickPhoto が黙って捨てていたこと。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.fn の中で投げると、vitest 5 は捕まえた後でもテストを落とすので、ふつうの関数で差し替える
let getPhoto: () => Promise<unknown> = async () => ({});
vi.mock("@capacitor/camera", () => ({
  Camera: { getPhoto: () => getPhoto() },
  CameraResultType: { DataUrl: "dataUrl" },
  CameraSource: { Prompt: "PROMPT", Camera: "CAMERA", Photos: "PHOTOS" },
}));
vi.mock("../src/native", () => ({ isNative: () => true }));

const { classifyPickError, pickPhoto } = await import("../src/camera");

describe("classifyPickError", () => {
  it("やめた / 許可が無い / それ以外 に分ける", () => {
    expect(classifyPickError("User cancelled photos app")).toBe("cancelled");
    expect(classifyPickError("User denied access to camera")).toBe("denied");
    expect(classifyPickError("User denied access to photos")).toBe("denied");
    expect(
      classifyPickError(
        "You are missing NSPhotoLibraryAddUsageDescription in your Info.plist file. Camera will not function without it.",
      ),
    ).toBe("failed");
    expect(classifyPickError("Camera not available while running in Simulator")).toBe("failed");
  });
});

describe("pickPhoto（ネイティブ）", () => {
  beforeEach(() => {
    getPhoto = async () => ({});
  });

  it("やめたときは null（何も言わない）", async () => {
    getPhoto = async () => {
      throw new Error("User cancelled photos app");
    };
    expect(await pickPhoto()).toBeNull();
  });

  it("許可が無いときは denied", async () => {
    getPhoto = async () => {
      throw new Error("User denied access to photos");
    };
    expect(await pickPhoto()).toEqual({ error: "denied" });
  });

  it("それ以外の断りは黙って捨てず failed を返す（画面で知らせる）", async () => {
    getPhoto = async () => {
      throw new Error("You are missing NSPhotoLibraryAddUsageDescription in your Info.plist file.");
    };
    expect(await pickPhoto()).toEqual({ error: "failed" });
  });

  it("画像が返ってこなかったときも failed", async () => {
    getPhoto = async () => ({ format: "jpeg" });
    expect(await pickPhoto()).toEqual({ error: "failed" });
  });
});

describe("iOS の Info.plist", () => {
  // @capacitor/camera の iOS（CameraPropertyListKeys）は、この 3 つが 1 つでも欠けると getPhoto を断る
  it("カメラのプラグインが求める利用目的を 3 つとも持つ", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const plist = readFileSync(join(root, "ios/App/App/Info.plist"), "utf8");
    for (const key of ["NSCameraUsageDescription", "NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription"]) {
      expect(plist).toMatch(new RegExp(`<key>${key}</key>\\s*<string>[^<]+</string>`));
    }
  });
});
