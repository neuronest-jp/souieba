---
name: iphone-install
description: そういえば。の画面をビルドして、Mac につないだ iPhone に Debug ビルドを入れて起動する。「iPhone に入れて」「実機で見たい」「直した版を入れて」と言われたとき、または実機でしか確かめられない直し（触覚・鍵盤・ダブルタップ・なぞり）のあとに使う。
---

# iPhone に入れる

11/5〜11/7 に 10 回以上くり返した手順をまとめたもの。開発者の Mac のセッションだけで使える（クラウドの Linux では iOS のビルドができない）。
詳しい前提は `docs/setup-capacitor.md`。UDID・チーム ID・LAN の IP はリポジトリに書かない（その場で読む）。

## 1. iPhone が見えるか

```sh
xcrun devicectl list devices
```

- `physical` の行が `available (paired)` なら進む。UDID はこの行から読む
- `unavailable` なら、開発者に「iPhone のロックを外して、Mac と同じ Wi-Fi につないで」と頼み、返事を待つ（待つ間に下の 2・3 は進めてよい）

## 2. つなぐ先を決める

- **LAN の Worker（ふだん）**: `LAN_EMAIL=<ログインに使うメール> pnpm dev:worker:lan` が動いていること。本番と同じ認証で、`X-Dev-User` は効かない。
  招待コードは起動のたびに乱数で作られ、起動した端末にだけ出る（会話やログに写さない）。
  `curl -s -o /dev/null -w '%{http_code}\n' http://<LAN の IP>:<ポート>/api/health` が 200 を返すこと
- **本番**: 開発者が deploy した Worker の URL。deploy は開発者が行う（自分では実行しない）

## 3. 画面をビルドして同期する

```sh
export VITE_API_BASE=http://<LAN の IP>:<ポート>   # 本番なら本番の URL
pnpm build:web && npx cap copy ios
grep -o "$VITE_API_BASE" ios/App/App/public/assets/*.js | head -1   # 向き先が入ったか
```

Simulator の写しを撮ったあとは `VITE_API_BASE=http://localhost:8787` のビルドが残っているので、必ずビルドし直す。

## 4. ビルドして入れる

チーム ID は開発者の環境変数 `DEVELOPMENT_TEAM` から渡す（`project.pbxproj` には書かない）。

```sh
cd ios/App && xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
  -destination "id=<UDID>" -derivedDataPath build DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
  -allowProvisioningUpdates build -quiet && cd ../..
xcrun devicectl device install app --device <UDID> ios/App/build/Build/Products/Debug-iphoneos/App.app
xcrun devicectl device process launch --terminate-existing --device <UDID> jp.neuronest.souieba
```

- `IDERunDestination: Supported platforms for the buildables in the current scheme is empty.` は出ても害が無い
- 終わったかは `App.app/App` の更新時刻で確かめる（Bash は zsh なので `${PIPESTATUS[0]}` は空になる）
- 署名ファイル（`*.mobileprovision`、`*.p12` など）には書き込まない（フックが拒否する）

## 5. 報告する

入れたコミット（`git log --oneline -1`）、つなぐ先、実機で確かめてほしいこと（触覚・鍵盤・なぞりなど、Simulator では確かめられないもの）を短く伝える。
