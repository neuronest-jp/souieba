// ネイティブ（Capacitor）で動いているときだけ行う設定。Web では何もしない。
// 相手は iPhone（ADR-0011）。Android はビルドが通る状態を保つだけで、Android 向けの調整はしない。
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { setKeyboard } from "./keyboard";

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const platform = (): string => Capacitor.getPlatform();

// ステータスバー: 明るい地に濃い文字。capacitor.config.ts の StatusBar.style と Info.plist の UIUserInterfaceStyle（Light）でも
// 同じにしてあるので、ここは念のため。Android（API 36）ではステータスバーは常に重なり、上余白は .safe-area の env() で取る
const setupStatusBar = async (): Promise<void> => {
  try {
    await StatusBar.setStyle({ style: Style.Light });
  } catch {
    /* プラグインが無い環境 */
  }
};

// 鍵盤（@capacitor/keyboard）。resize は capacitor.config.ts で native（鍵盤のぶん WKWebView の枠を縮める）。
// 画面の部品には keyboard.ts の setKeyboard で出入りを知らせる（<html data-keyboard="open"> と --keyboard-height）。
// 下部ナビは鍵盤が出ている間 styles/platform.css で隠す（縮んだ枠の下端で、鍵盤のすぐ上に 68px の帯が残らないように）。
// - 高さ 0 の「出る」は閉じている扱い: 外付けの鍵盤のときは、予測の帯だけが出て、プラグインは 0 を知らせる
// - 鍵盤を閉じる手段: 付属バーの「完了」を出す。プラグインは読み込みで付属バーを消すが、便箋は textarea で、
//   改行のキーは改行を入れるだけなので、「完了」が無いと閉じる手段が「書いていない所を押す」しか残らない
// - スクロールで鍵盤を閉じることはしない（WKWebView の keyboardDismissMode は設定から変えられず、
//   書いている行を見える位置に送る WebView のスクロールと区別できない）
const setupKeyboard = async (): Promise<void> => {
  try {
    await Keyboard.addListener("keyboardWillShow", ({ keyboardHeight }) => setKeyboard(keyboardHeight > 0, keyboardHeight));
    await Keyboard.addListener("keyboardWillHide", () => setKeyboard(false, 0));
  } catch {
    /* プラグインが無い環境 */
  }
  try {
    await Keyboard.setAccessoryBarVisible({ isVisible: true });
  } catch {
    /* iOS だけの機能（Android では使えない） */
  }
};

export async function setupNative(): Promise<void> {
  if (!isNative()) return;
  await Promise.all([setupStatusBar(), setupKeyboard()]);
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
