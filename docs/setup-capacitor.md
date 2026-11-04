# Capacitor（iOS / Android）の手順書

対象: そういえば。（appId `jp.neuronest.souieba`、表示名「そういえば。」。ADR-0007）
前提: 画面は `web/`（Vite）で作り、`web/dist` を Capacitor が各プラットフォームにコピーする。API は Cloudflare Workers。

Claude Code の環境は Linux のため、`cap add` と `cap sync` までは済ませてある。iOS のビルド・シミュレータ・実機、Android のビルドは開発者の Mac で行う
（この環境は `dl.google.com` に出られず Android SDK を入れられない）。

## 0. 必要なもの（Mac）

| もの | 版の目安 | 確認 |
|---|---|---|
| Node 22 / pnpm 10 | `.node-version` | `node -v`、`pnpm -v` |
| Xcode | 16 以上 | `xcodebuild -version` |
| Xcode のコマンドラインツール | | `xcode-select -p` |
| CocoaPods | Capacitor 8 は Swift Package Manager を使うため **不要**（`ios/App/CapApp-SPM/Package.swift` が生成されている） | |
| Android Studio | Ladybug 以降（Android SDK 35、JDK 21 同梱） | `studio` を起動 |
| Apple Developer のチーム | シミュレータだけなら不要。実機・配布は必要 | Xcode の Signing で選ぶ |

## 1. 画面のビルドと同期

```sh
pnpm install
pnpm build:web          # web/dist
pnpm exec cap sync      # ios/ と android/ に web/dist とプラグインをコピー
```

API のベース URL は Vite の環境変数 `VITE_API_BASE` で決める（`web/.env.example`）。

| 用途 | 値 | 置き場所 |
|---|---|---|
| 本番（配布用） | `https://<api-domain>`（Workers のカスタムドメインか `https://souieba.<account>.workers.dev`） | `web/.env.production`（git には入れない） |
| iOS シミュレータからローカルの Worker | `http://localhost:8787` | `web/.env.local` |
| Android エミュレータからローカルの Worker | `http://10.0.2.2:8787` | `web/.env.local` |
| 実機からローカルの Worker | `http://<Mac の LAN IP>:8787`（`wrangler dev --ip 0.0.0.0`） | `web/.env.local` |

`http://` で API を叩くのは開発だけ。iOS は `NSAppTransportSecurity` の例外が無いと `http://localhost` 以外を拒否する。本番は必ず `https://`。

ローカルの Worker は `pnpm dev:worker` で起動する（開発専用の招待コード `dev`、`JWT_SECRET` も開発用の既定値。`.dev.vars` があればそちらが優先）。

## 2. iOS

```sh
pnpm build:web && pnpm exec cap sync ios
pnpm exec cap open ios      # Xcode で ios/App/App.xcodeproj を開く
```

Xcode で:

1. 左のツリーで `App` → Targets `App` → Signing & Capabilities。シミュレータだけなら Team は空でよい。実機ならチームを選ぶ（Bundle Identifier は `jp.neuronest.souieba`）
2. 上部の実行先で iPhone のシミュレータを選び、▶ で実行
3. ログイン画面で招待コードとメールアドレスを入れ、「はじめる」→ S1「きょう」が出れば到達
4. 「写真を添える」で撮影 / ライブラリの選択肢が出る（`Info.plist` の `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` は設定済み）

コマンドラインで通すなら:

```sh
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 16' -derivedDataPath build build
```

Capacitor 8 は Package.swift で依存を解決する。初回は Xcode がパッケージを取りに行くので少し待つ。

## 3. Android

```sh
pnpm build:web && pnpm exec cap sync android
pnpm exec cap open android  # Android Studio で android/ を開く
```

Android Studio で Gradle の同期が終わったら、エミュレータか実機で ▶。コマンドラインで通すなら:

```sh
cd android && ./gradlew assembleDebug
# android/app/build/outputs/apk/debug/app-debug.apk
```

`android/local.properties`（SDK の場所）は Android Studio が作る。git には入れない。

## 4. 見た目

- ステータスバー: `web/src/native.ts` が文字色を `Style.Light`（明るい地に濃い文字）にする。Android 16（API 36）以降ではステータスバーは常に画面に重なり、背景色の指定は効かない。上の余白は `web/src/style.css` の `.safe-area` が `env(safe-area-inset-top)` で取る
- スプラッシュ: `capacitor.config.ts` の `SplashScreen.backgroundColor` が `#FAF5EC`。画像（ロゴ）は未作成。作るなら `@capacitor/assets` で生成する（依存を増やすので提出直前に判断）
- アイコン: Capacitor の既定のまま。`ios/App/App/Assets.xcassets/AppIcon.appiconset` と `android/app/src/main/res/mipmap-*` を差し替える。素材は開発者が権利を持つものだけ
- セーフエリア: `web/src/style.css` の `.safe-area` と下部ナビの `env(safe-area-inset-bottom)`

## 5. 更新の流れ

画面を直したら必ず `pnpm build:web && pnpm exec cap sync` を通す。`cap sync` を忘れると古い画面がアプリに残る。
Worker の変更は `pnpm run deploy`（docs/setup-cloudflare.md）。

## 6. 禁止と注意

- `ios/` `android/` 配下の署名ファイル（`*.mobileprovision`、`*.p12`、`*.cer`、`ExportOptions.plist`、`*.keystore`、`*.jks`、`key.properties`、`google-services.json`、`GoogleService-Info.plist`）は git に入れず、Claude Code も書き込めない（フック）
- `ios/App/Pods/`、`ios/App/public/`、`android/app/src/main/assets/public/`、`build/` は生成物で git に入れない
- 通知（P1）は `@capacitor/push-notifications` を候補にするが、APNs / FCM の設定は 11/8 時点で P0 が完了している場合だけ

## 7. チェックリスト

| 項目 | 値 | 済 |
|---|---|---|
| `web/.env.production` の `VITE_API_BASE` | | |
| Xcode でシミュレータ起動 → ログイン → S1 | | |
| Android `assembleDebug` が通る | | |
| 実機で写真の撮影とライブラリ選択 | | |
| アイコン / スプラッシュ画像 | | |
