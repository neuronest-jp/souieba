// ネイティブ（Capacitor）で動いているときだけ行う設定。Web では何もしない。
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

export const isNative = (): boolean => Capacitor.isNativePlatform();

export async function setupNative(): Promise<void> {
  if (!isNative()) return;
  try {
    // 明るい地に濃い文字。Android（API 36）ではステータスバーは常に重なり、上余白は .safe-area の env() で取る
    await StatusBar.setStyle({ style: Style.Light });
  } catch {
    /* プラグインが無い環境 */
  }
}

// スプラッシュ（「そういえば。」）を、起動から少なくともこの時間は見せる。すぐ消えると一瞬ちらつくだけになる
const SPLASH_MIN_MS = 900;

export async function hideSplash(): Promise<void> {
  if (!isNative()) return;
  const wait = SPLASH_MIN_MS - performance.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  try {
    await SplashScreen.hide({ fadeOutDuration: 300 });
  } catch {
    /* 無視 */
  }
}
