import type { CapacitorConfig } from "@capacitor/cli";

// そういえば。 のネイティブアプリ設定（ADR-0007）。画面は web/dist（pnpm build:web の出力）。
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
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    // 起動画面とスプラッシュは同じ画像（地の色に「そういえば。」）。画面の準備ができたら native.ts の hideSplash が
    // 少なくとも 0.9 秒は見せてからふわっと消す。3 秒は画面が動かなかったときの保険
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
  },
};

export default config;
