import type { CapacitorConfig } from "@capacitor/cli";

// そういえば。 のネイティブアプリ設定（ADR-0007）。画面は web/dist（pnpm build:web の出力）。
const config: CapacitorConfig = {
  appId: "jp.neuronest.souieba",
  appName: "そういえば。",
  webDir: "web/dist",
  backgroundColor: "#FAF5EC",
  ios: {
    contentInset: "automatic",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
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
