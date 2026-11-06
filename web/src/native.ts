// ネイティブ（Capacitor）で動いているときだけ行う設定。Web では何もしない。
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const platform = (): string => Capacitor.getPlatform();

export async function setupNative(): Promise<void> {
  if (!isNative()) return;
  try {
    // 明るい地に濃い文字。Android（API 36）ではステータスバーは常に重なり、上余白は .safe-area の env() で取る
    await StatusBar.setStyle({ style: Style.Light });
  } catch {
    /* プラグインが無い環境 */
  }
}

// ネイティブのスプラッシュ（止まった「そういえば。」の画像）を、すぐに外す。
// 見せる時間と動きは画面側の SplashOverlay.vue が受け持つ（同じ絵を同じ位置に描いてから呼ぶので、入れ替わりは見えない）
export async function hideSplash(): Promise<void> {
  if (!isNative()) return;
  try {
    await SplashScreen.hide({ fadeOutDuration: 0 });
  } catch {
    /* 無視 */
  }
}
