import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize, KeyboardStyle } from "@capacitor/keyboard";

// そういえば。 のネイティブアプリ設定（ADR-0007）。画面は web/dist（pnpm build:web の出力）。
// 相手は iPhone（ADR-0011）。Android はビルドが通る状態を保つだけで、Android 向けの調整はしない。
const config: CapacitorConfig = {
  appId: "jp.neuronest.souieba",
  appName: "そういえば。",
  webDir: "web/dist",
  backgroundColor: "#FAF5EC",
  ios: {
    // セーフエリアは CSS の env(safe-area-inset-*) だけで取る（.safe-area、下部ナビ、シート）。
    // "automatic" だと WKWebView がページがスクロールできるときだけ上下をずらし、そのあいだ env() が 0 になるため、
    // 短い S1 と長い S2 で下部ナビの高さが変わっていた（wireframes 第8節 #23）
    contentInset: "never",
    // 長押しでリンクの行き先（capacitor://localhost/#memory/…）の下見を出さない。札（RecallCard）は札全体がリンクなので、
    // 引用を長押しすると技術の URL の下見が開く。拡大（zoomEnabled）と弾む動き（scrollView.bounces）は Capacitor の既定で切れている
    allowsLinkPreview: false,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    // 起動画面とスプラッシュは同じ画像（地の色に「そういえば。」）。画面側の SplashOverlay.vue が同じ絵を同じ位置に描いたら
    // native.ts の hideSplash がすぐ外し、そこから画面側で動かす。3 秒は画面が動かなかったときの保険
    SplashScreen: {
      launchShowDuration: 3000,
      launchAutoHide: true,
      launchFadeOutDuration: 300,
      androidScaleType: "CENTER_CROP",
      backgroundColor: "#FAF5EC",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "LIGHT", // 背景色と overlaysWebView は Android 16 以降では効かないため指定しない（上余白は CSS の env()）
    },
    // 鍵盤（ブラッシュアップ 11/7、ADR-0011。見直し n=10）。
    // resize は native（鍵盤のぶん WKWebView の枠を縮める）。プラグインはどの方式でも WKWebView 自身の鍵盤の扱いを外すので、
    // none では書いている行を鍵盤の上へ送るものが無くなり、body では body の高さだけが変わって min-h-dvh の中身ははみ出す。
    // native なら 100dvh も縮み、書いている行と「保存する」は WebView のスクロールで鍵盤の上に届く。
    // 縮んだ枠の下端に下部ナビが出て高さも 96px → 68px に変わる件は、鍵盤が出ている間ナビを隠して直す
    // （native.ts が鍵盤の出入りを keyboard.ts に知らせ、styles/platform.css が html[data-keyboard="open"] で隠す）
    Keyboard: {
      resize: KeyboardResize.Native,
      style: KeyboardStyle.Light, // 地は明るい紙だけ。端末が暗い表示でも鍵盤は明るく
      // 枠が縮む間と、角の丸い鍵盤の脇に見える窓の地を紙の色（backgroundColor）にする。既定の off では黒が見える
      autoBackdropColor: "auto",
    },
  },
};

export default config;
