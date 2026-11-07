// 写真の取得。ネイティブでは @capacitor/camera（撮影 / ライブラリ）、Web では <input type="file">。
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { isNative } from "./native";

// denied: 許可が無い（設定で変えられる）。failed: それ以外で開けなかった（黙って何もしないと「押しても何も起きない」に見えるので、画面で知らせる）
export type PickedPhoto = { file: File } | { error: "denied" | "failed" };

// プラグインの失敗の文を、やめた / 許可が無い / それ以外 に分ける。
// iOS のプラグインは Info.plist の利用目的（NSCameraUsageDescription、NSPhotoLibraryUsageDescription、
// NSPhotoLibraryAddUsageDescription）が 1 つでも欠けると、選択肢を出す前に "You are missing … in your Info.plist" で断る。
// 以前は 3 つめが無く、その断りをここで捨てていたため、押しても何も起きなかった（11/7 実機）
export const classifyPickError = (msg: string): "cancelled" | "denied" | "failed" => {
  if (/cancel/i.test(msg)) return "cancelled";
  if (/denied|permission/i.test(msg)) return "denied";
  return "failed";
};

const pickWithInput = (): Promise<PickedPhoto | null> =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png";
    input.onchange = () => {
      const f = input.files?.[0] ?? null;
      resolve(f ? { file: f } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });

const dataUrlToFile = async (dataUrl: string, name: string): Promise<File> => {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || "image/jpeg" });
};

// source: "prompt" なら撮影かライブラリかを OS の UI で選ぶ。
export async function pickPhoto(source: "prompt" | "camera" | "photos" = "prompt"): Promise<PickedPhoto | null> {
  if (!isNative()) return pickWithInput();
  try {
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.DataUrl,
      source: source === "camera" ? CameraSource.Camera : source === "photos" ? CameraSource.Photos : CameraSource.Prompt,
      quality: 85,
      width: 1600,
      height: 1600,
      correctOrientation: true,
      promptLabelHeader: "写真を添える",
      promptLabelPhoto: "ライブラリから選ぶ",
      promptLabelPicture: "撮る",
      promptLabelCancel: "やめる",
    });
    if (!photo.dataUrl) return { error: "failed" };
    return { file: await dataUrlToFile(photo.dataUrl, `photo.${photo.format || "jpeg"}`) };
  } catch (e) {
    const kind = classifyPickError(e instanceof Error ? e.message : String(e));
    if (kind === "cancelled") return null; // やめた
    return { error: kind };
  }
}
