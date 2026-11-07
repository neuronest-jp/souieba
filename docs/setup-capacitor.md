# Capacitor（iOS / Android）の手順書

対象: そういえば。（appId `jp.neuronest.souieba`、表示名「そういえば。」。ADR-0007）
前提: 画面は `web/`（Vite）で作り、`web/dist` を Capacitor が各プラットフォームにコピーする。API は Cloudflare Workers。
相手は iPhone だけ（11/7、ADR-0011）。Android はビルドが通る状態を保つが、Android 向けの調整（アイコン、鍵盤、ステータスバー、戻るボタン）はしない。

クラウド（Linux）の Claude Code のセッションでは `cap add` と `cap sync` までしかできない（`dl.google.com` に出られず Android SDK も入らない）。
iOS のビルド・シミュレータ・実機、Android のビルドは開発者の Mac で行う。Mac の Claude Code のセッションなら、2.1 節のコマンドで実機へのインストールまで通る（2026-11-05 に iPhone 16 Pro で確認）。

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
| 実機からローカルの Worker | `http://<Mac の LAN IP>:8787`（`pnpm dev:worker:lan`。1.1 節） | `web/.env.local` |

`http://` で API を叩くのは開発だけ。iOS は `NSAppTransportSecurity` の例外が無いと `http://localhost` 以外を拒否する。本番は必ず `https://`。

ローカルの Worker は `pnpm dev:worker` で起動する（開発専用の招待コード `dev`、`JWT_SECRET` も開発用の既定値。`.dev.vars` があればそちらが優先）。
`pnpm dev:worker` は Mac の中（`localhost`）からしか届かない。実機から叩くときは 1.1 節。

### 1.1 実機からローカルの Worker を叩く（開発だけ）

1. Mac の LAN IP を調べる: `ipconfig getifaddr en0`（Wi-Fi。iPhone と同じネットワークにいること）
2. `web/.env.local` に `VITE_API_BASE=http://<LAN IP>:8787` を書く（git には入れない）
3. Worker を LAN に公開して起動する: `LAN_EMAIL=you@example.com pnpm dev:worker:lan`（scripts/dev-worker-lan.sh。fish なら `env LAN_EMAIL=you@example.com pnpm dev:worker:lan`）。起動時に URL と招待コードを表示する。
   別の端末から `curl http://<LAN IP>:8787/api/health` が 200 になることを確かめる。
   **`pnpm dev:worker` に `--ip 0.0.0.0` を足して LAN に出さない。** development は `X-Dev-User` ヘッダだけで誰にでもなれ、招待コード `dev` と署名鍵 `dev-only-secret` も公開済みなので、
   同じ Wi-Fi（会場など）の誰でも他人の記憶を読み書きでき、トークンも偽造できる。`dev:worker:lan` は次のようにしてある:
   - `ENVIRONMENT=lan`（development ではない）→ `X-Dev-User` は無視、署名鍵は 32 文字以上が必須（本番と同じ認証）
   - 招待コードと署名鍵は乱数で作り `.wrangler/lan-dev.secrets`（gitignore 済み、権限 600）に保存して次回も使う。作り直すならファイルを消す（端末はログイン画面に戻る）
   - 招待コードは `LAN_EMAIL`（必須）に結びつく（`INVITE_CODE=<乱数>=<LAN_EMAIL>`。本番と同じ 1 人 1 つの形）。保存済みのファイルが古い形式（コードだけ）か別のメール用なら、起動せずに作り直しを案内する
   - ポートは既定の 8787。使用中なら `LAN_PORT=8797` のように変える
   - 待ち受けは Mac の LAN の IP（`ipconfig getifaddr en0`、`LAN_IP=` で上書き可）だけ。`127.0.0.1` や VPN のインターフェースには出さない
4. iOS の ATS は、ローカルネットワークだけの例外（`NSAppTransportSecurity` → `NSAllowsLocalNetworking`）を ios/App/App/Info.plist にコミット済み（11/6。`NSAllowsArbitraryLoads` にはしない）。LAN の `http://` に追加の作業なしでつながる。本番の `https://` には影響しない
5. `pnpm cap:sync` → 2.1 節で実機に入れる。ログインは 3 で表示された招待コード（`cat .wrangler/lan-dev.secrets` の `INVITE_CODE=` の次から 2 つ目の `=` の前まで）と `LAN_EMAIL` のメール

2026-11-05 にこの手順で iPhone 16 Pro から ログイン → 保存 → 一覧 → 詳細 まで通ることを Worker のログで確認した（アプリの WebView からの CORS preflight `OPTIONS` が付いている）。
このキーを外した状態で LAN の IP が弾かれるかは試していない。許可はローカルネットワークだけなので、本番（`https://`）のビルドに残しても影響しない。

## 2. iOS

```sh
pnpm build:web && pnpm exec cap sync ios
pnpm exec cap open ios      # Xcode で ios/App/App.xcodeproj を開く
```

Xcode で:

1. 左のツリーで `App` → Targets `App` → Signing & Capabilities。シミュレータだけなら Team は空でよい。実機ならチームを選ぶ（Bundle Identifier は `jp.neuronest.souieba`）
2. 上部の実行先で iPhone のシミュレータを選び、▶ で実行
3. ログイン画面で招待コードとメールアドレスを入れ、「はじめる」→ S1「きょう」が出れば到達
4. 「写真を添える」で撮影 / ライブラリの選択肢が出る（`Info.plist` の `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` / `NSPhotoLibraryAddUsageDescription` は設定済み。`@capacitor/camera` の iOS は 3 つの 1 つでも欠けると選択肢を出さずに断る。保存はしないが 3 つめも要る）

コマンドラインで通すなら:

```sh
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 16' -derivedDataPath build build
```

Capacitor 8 は Package.swift で依存を解決する。初回は Xcode がパッケージを取りに行くので少し待つ。

### 2.1 実機（コマンドライン）

Xcode を開かずに入れるなら（端末は USB か同じ Wi-Fi でペアリング済み、ロックを解除しておく）:

```sh
xcrun devicectl list devices                       # 実機の UDID（Identifier）を調べる
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
  -destination 'id=<UDID>' -derivedDataPath build \
  DEVELOPMENT_TEAM=<チーム ID> -allowProvisioningUpdates build
cd ../..
xcrun devicectl device install app --device <UDID> ios/App/build/Build/Products/Debug-iphoneos/App.app
xcrun devicectl device process launch --device <UDID> jp.neuronest.souieba
```

- チーム ID は `project.pbxproj` に書かず、引数で渡す。証明書名の括弧の中（`Apple Development: 名前 (XXXXXXXXXX)`）は個人の ID で、チーム ID ではない。
  チーム ID は Xcode の Signing で選んだチーム、またはプロファイルの `TeamIdentifier`
- 初回の起動で「信頼されていないデベロッパ」と出たら、端末の 設定 → 一般 → VPN とデバイス管理 で信頼する
- 初回ビルドで `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` ができる。SPM の版を固定するためにコミットしている（11/6。capacitor-swift-pm 8.6.0、ion-ios-camera 2.0.0）。プラグインを足したり版を上げたら、更新された Package.resolved もコミットする。
  11/7 に足した `@capacitor/haptics` と `@capacitor/keyboard` は `ios/App/CapApp-SPM/Package.swift` に `node_modules` の中の場所で入る（`cap sync` が書く）。外から取ってくる依存は増えないので、Package.resolved が変わらなくてよい

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

Android はビルドが通ることだけを保つ（ADR-0011）。`@capacitor/haptics` と `@capacitor/keyboard` も `cap sync android` で入るが、付属バーの「完了」は iOS だけの機能で、Android では使えない（`native.ts` が失敗を無視する）。`Keyboard.resize` などの設定も iOS の分だけ。

## 4. 見た目と手ざわり

- ステータスバー: `web/src/native.ts` が文字色を `Style.Light`（明るい地に濃い文字）にする。Android 16（API 36）以降ではステータスバーは常に画面に重なり、背景色の指定は効かない。上の余白は `web/src/style.css` の `.safe-area` が `env(safe-area-inset-top)` で取る
- スプラッシュ: 地の色 `#FAF5EC` に「そういえば。」（Zen Maru Gothic の太字、句点は ember。ADR-0008）。iOS は `ios/App/App/Assets.xcassets/Splash.imageset`（2732px 四方、`LaunchScreen.storyboard` も同じ画像なので起動画面から一続き）、Android は `res/drawable*/splash.png`（解像度ごと）と `values/styles.xml` の `windowSplashScreenBackground`（Android 12 以降はシステムの起動画面にアイコンが出る）。`capacitor.config.ts` の `SplashScreen` は 3 秒の保険と `androidScaleType: "CENTER_CROP"`、`web/src/native.ts` の `hideSplash` が少なくとも 0.9 秒見せてから 0.3 秒で消す。動きは画面側の `web/src/components/SplashOverlay.vue`（起動画像を 1 字ずつ切った `web/src/assets/splash/` と位置の `web/src/splashMark.ts`。起動画像を作り直したら、この 2 つも作り直す）
- アイコン（iOS。ADR-0011 の 10 節）: A「封蝋」（紙の地に朱の封蝋と押した葉）。`ios/App/App/Assets.xcassets/AppIcon.appiconset/` に 3 枚と `Contents.json`:
  `AppIcon.png`（1024 × 1024 の不透明な RGB。透明があると App Store に断られる）、`AppIcon-dark.png` と `AppIcon-tinted.png`（地が透明。iOS 18 以降の暗い表示と色付きの表示。`appearances` の `luminosity` が `dark` / `tinted`）。
  素材は使わず、SVG を書いて headless Chrome で描いた PNG。描き直すときも 1024 × 1024 で同じ 3 つのファイル名にする（`web/test/platform.test.ts` が大きさ・不透明・ファイルの有無を見張る）。
  Android（`android/app/src/main/res/mipmap-*`）は Capacitor の既定のまま（Android の調整はしない）。素材は開発者が権利を持つものだけ
- 表示と向き（`ios/App/App/Info.plist`）: `UIUserInterfaceStyle = Light`（端末が暗い表示でも明るい紙。鍵盤・日付の選択・写真の選択も明るい）、`UIStatusBarStyle = UIStatusBarStyleDarkContent`（起動画面の間の時計も濃い文字）、iPhone は縦だけ（`UISupportedInterfaceOrientations` は `Portrait` だけ。iPad の項目はそのまま）。`web/index.html` も `color-scheme: light` と `format-detection`（数字を電話のリンクにしない）
- 鍵盤（`@capacitor/keyboard`。ADR-0011 の 4 節）: `capacitor.config.ts` の `Keyboard` は `resize: KeyboardResize.Native`（鍵盤のぶん WKWebView の枠を縮める。`none` / `body` にすると書いている行が鍵盤の下に隠れる）、`style: KeyboardStyle.Light`、`autoBackdropColor: "auto"`（鍵盤の脇の窓を `backgroundColor` の紙の色に）。
  `web/src/native.ts` が `keyboardWillShow` / `keyboardWillHide` を `web/src/keyboard.ts` の `setKeyboard` に渡し、`<html data-keyboard="open">` の間は `web/src/styles/platform.css` が下部ナビを隠す。付属バー（∧ ∨ 完了）は `Keyboard.setAccessoryBarVisible({ isVisible: true })` で出す（プラグインは既定で消す）。
  入力欄の文字は 16px 以上（16px 未満だと iOS が入力欄を拡大する。`web/test/platform.test.ts` が `.vue` を見張る。いまは全部 17px）
- 触覚（`@capacitor/haptics`。ADR-0011 の 3 節）: 画面からは `web/src/haptics.ts` の `tap` / `select` / `stamp` / `saved` / `arrive` / `failed` だけを呼ぶ。Web では何もしない。**Simulator には Taptic Engine が無いので鳴らない**（確かめるのは実機だけ）
- 長押しと拡大: `ios.allowsLinkPreview: false`（札を長押ししても `capacitor://localhost/#memory/…` の下見を出さない）。ピンチの拡大と弾む動きは Capacitor の既定で切れている（`zoomEnabled = false`、`scrollView.bounces = false`）。ダブルタップの拡大は `web/index.html` の viewport（`maximum-scale=1, user-scalable=no`）で止める（ADR-0011 の 13 節）。押すもの・絵・写真の選択と長押しのメニューは `styles/platform.css` で止める（本文は選べる）
- セーフエリア: `web/src/style.css` の `.safe-area` と下部ナビの `env(safe-area-inset-bottom)`。iOS は `capacitor.config.ts` の `ios.contentInset` を `"never"`（Capacitor の既定）にして、セーフエリアを CSS の `env()` だけで取る。`"automatic"` にすると、ページがスクロールできるときだけ WKWebView がずらして `env()` が 0 になり、画面ごとに下部ナビの高さが変わる（wireframes 第8節 #23）。ステータスバーの下の地は `App.vue` の固定の `div`

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
| Android `assembleDebug` が通る | JDK 21 で通る（11/6。app-debug.apk 7.9MB。JDK 25 では Gradle 8.14.3 が動かない） | 済 |
| 実機で写真の撮影とライブラリ選択 | | |
| アイコン / スプラッシュ画像 | iOS のアイコンは A「封蝋」（11/7。ADR-0011）。スプラッシュは ADR-0008 | 済（iOS） |

### 7.1 実機で確かめること（11/7 のブラッシュアップ。ADR-0011）

11/7 は iPhone 17（iOS 27.0）の Simulator と headless Chrome でしか見ていない。Simulator で確かめたもの: 鍵盤で WebView が 874 → 470pt に縮み `keyboardHeight` が 404、下部ナビが消えて閉じると 96px に戻る、「完了」で閉じる、書いている行と S1 の「保存する」が鍵盤の上に出る、
ナビと S2 の行を長押ししても下見が出ない、S3 の本文が選べてコピーできる、端末が暗い表示でも鍵盤とステータスバーが明るい。前に起きた「WebView が白いまま」は 4 回入れ直して起きなかった。

| 項目 | 見ること | 済 |
|---|---|---|
| 触覚 6 つ | 押した直後に鳴るか、強さ（`stamp` が強すぎないか）、届いた札の `arrive` が封蝋の沈みと合うか。ナビの同じ項目・組を開くときに鳴らないこと | |
| S3 を左端からなぞって戻る | 指に付いてくるか、縦のスクロールと取り合わないか、半分より右・速く払ったときに戻るか | |
| シートをなぞって閉じる | DateSheet・「消しますか」・S5 のシートで、下へなぞると閉じる、中身のスクロールと取り合わない、開いている間に後ろがスクロールしない | |
| 画面の移り変わり | 下部ナビの左右、S3 の push / pop が滑らかか（60fps）、離れていく画面が 1 フレーム透けないか | |
| 押したときの沈み | 行・札・ボタンが指で沈むか（`:active`） | |
| 鍵盤 | 実機の鍵盤（かな・英字・音声・外付け・ほかの会社の鍵盤）で下部ナビが消えて戻る、「保存する」が鍵盤の上、「完了」で閉じる | |
| 長押し | 札で下見が出ない、本文は選べる、写真は「画像を保存」が出ない | |
| アイコン | ホーム画面の明るい表示・暗い表示・色付きの表示、29pt（設定の一覧）でも朱の丸と葉が残る | |
| 時間帯の紙 | 17 時・21 時に地と下部ナビ・シートの継ぎ目が出ない、起動の絵から地へ溶ける（`main.ts` が mount の前に `applyTimeOfDay` を呼ぶ） | |
