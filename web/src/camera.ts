// 写真の取得。ネイティブでは @capacitor/camera（撮影 / ライブラリ）、Web では <input type="file">。
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { isNative } from "./native";

export type PickedPhoto = { file: File } | { error: "denied" };

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
    if (!photo.dataUrl) return null;
    return { file: await dataUrlToFile(photo.dataUrl, `photo.${photo.format || "jpeg"}`) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) return null; // やめた
    if (/denied|permission/i.test(msg)) return { error: "denied" };
    return null;
  }
}
