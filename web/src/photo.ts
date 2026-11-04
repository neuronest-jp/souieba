// 写真の縮小（requirements F2 写真の縮小、F2-10）。長辺 1600px 以下、JPEG 品質 0.85。依存なし（Canvas API）。
export const PHOTO_MAX_BYTES = 10_485_760;
export const PHOTO_MAX_EDGE = 1600;

const loadImage = (file: Blob): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読めませんでした"));
    };
    img.src = url;
  });

// 縮小した JPEG を返す。読めない画像や Canvas が使えない環境では元のファイルをそのまま返す。
export async function shrinkPhoto(file: File): Promise<Blob> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return file;
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return file;
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(w, h));
  if (scale === 1 && file.type === "image/jpeg" && file.size < 2_000_000) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  return blob ?? file;
}
