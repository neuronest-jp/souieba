// ネイティブ（Capacitor）で動いているときだけ行う設定。Web では何もしない。
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

export const isNative = (): boolean => Capacitor.isNativePlatform();

export async function setupNative(): Promise<void> {
  if (!isNative()) return;
  try {
    await StatusBar.setStyle({ style: Style.Light }); // 明るい地に濃い文字
    if (Capacitor.getPlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: "#FAF5EC" });
      await StatusBar.setOverlaysWebView({ overlay: false });
    }
  } catch {
    /* プラグインが無い環境 */
  }
}

export async function hideSplash(): Promise<void> {
  if (!isNative()) return;
  try {
    await SplashScreen.hide();
  } catch {
    /* 無視 */
  }
}
