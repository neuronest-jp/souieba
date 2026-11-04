# ADR-0007: 配布を PWA から Capacitor に切り替え、認証を招待コード + JWT にする

- 日付: 2026-11-04
- 状態: 採用（開発者の方針変更。仕様書 v0.3）

## 背景

v0.2 までは Workers の Static Assets で配信する SPA（PWA 相当）を Cloudflare Access（メール OTP）で守る構成だった。
開発者の判断で、iOS / Android のネイティブアプリとして配布する方針に変わった。
Capacitor の WebView は `capacitor://localhost`（iOS）/ `https://localhost`（Android）をオリジンにするため、
Cloudflare Access の Cookie もログインリダイレクトも成立しない。

## 決定

1. **配布**: Capacitor（`@capacitor/core` / `cli` / `ios` / `android`）。appId `jp.neuronest.souieba`、表示名「そういえば。」。
   `webDir` は `web/dist`。`ios/` と `android/` は git にコミットする（`Pods/`、`build/`、署名ファイルは除く）。
   Workers の Static Assets 配信は開発用プレビューとしてだけ残す
2. **認証**: 招待コード + メールアドレス → HS256 の JWT（有効 90 日）
   - `POST /api/auth/login { invite_code, email }`。Worker は `INVITE_CODE` と定数時間比較し、`JWT_SECRET` で署名した `{ sub, iat, exp }` を返す
   - アプリは `@capacitor/preferences` に保存し、`Authorization: Bearer` で送る。401 を受けたら消して S0 へ
   - Worker の Bearer 検証ミドルウェアが Access 検証（`worker/src/access.ts`）を置き換える。Access 前提のコードとテストは削除する
   - ローカルの `X-Dev-User`（`ENVIRONMENT=development` のみ）は残す
   - `/api/auth/login` は同一 IP から 1 分 10 回まで（D1 `login_attempts`）。招待コードの総当たりを遅らせる
3. **CORS**: `capacitor://localhost`、`https://localhost`、`http://localhost:5173` を許可。`Authorization` ヘッダを許可。Cookie は使わない
4. **画像入力**: `@capacitor/camera`（撮影 / ライブラリ）。Web 実行時は `<input type="file">` にフォールバック。R2 へのアップロードは Worker 経由の multipart のまま
5. **見た目**: `env(safe-area-inset-*)`、`@capacitor/status-bar` は文字色だけ（Android 16 以降は背景色が効かず常に重なる。上余白は CSS の env()）、`@capacitor/splash-screen` の背景は `#FAF5EC`
6. **secret**: `INVITE_CODE` と `JWT_SECRET` は wrangler secret。コードや文書に値を書かない。ローカルは開発者が `.dev.vars` に書く。
   `pnpm dev:worker` は開発専用の既定値（`INVITE_CODE=dev`、`JWT_SECRET=dev-only-secret`）を `--var` で渡す（`ENVIRONMENT=development` のときだけ使われる）
7. **フック**: `ios/` `android/` 配下の署名ファイル（`*.mobileprovision`、`*.p12`、`*.cer`、`ExportOptions.plist`、`*.keystore`、`*.jks`、`key.properties`、`google-services.json`、`GoogleService-Info.plist`）への書き込みを禁止する
8. **P1 通知**: `@capacitor/push-notifications` を候補にする。APNs / FCM は 11/8 時点で P0 完了のときだけ

## 既知の制約（脅威）

- **メールの所有確認をしない。** 招待コードが一致すれば、入力したメールアドレスをそのまま `sub`（user_id）にする。
  つまり招待コードを共有された人は、他の利用者のメールを入れるだけでその人の記憶と写真を読み書きできる。
  ハッカソン期間中は「招待コードを渡した相手だけが使う」前提の割り切りとし、提出後に続けるなら
  (a) 招待コードを 1 人 1 つにして code → email の対応表で固定する、(b) メールに 6 桁コードを送る OTP に戻す、のどちらかにする
- レート制限は IP 単位（1 分 10 回）で、コード全体の上限は無い。`login_attempts` は 1 時間で掃除する
- JWT の失効はログアウト以外に無い。`JWT_SECRET` のローテーションで全員ログアウトになる

## 影響

- docs/spec.md v0.3、requirements F1、architecture 3 章、wireframes S0、setup-cloudflare.md（Access の節を削除し、secret の節に `INVITE_CODE` / `JWT_SECRET` を追加）、tasks.md（11/4 以降の認証タスク）を追従させる
- この環境（Linux）では iOS のビルドと実機 / シミュレータ確認ができない。`cap add ios` までは行い、Xcode での手順を docs/setup-capacitor.md に書く。Android はここで SDK を入れて `assembleDebug` を確認する
- JWT の失効（ログアウト以外）は作らない。90 日で自然に切れる。秘密鍵をローテーションすれば全員ログアウトになる
