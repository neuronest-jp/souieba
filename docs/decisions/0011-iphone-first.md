# ADR-0011: iPhone だけを相手にして、手ざわり・動き・「つい記録したくなる」仕掛けを足す（ブラッシュアップ）

- 日付: 2026-11-07
- 状態: 採用
- 関連: ADR-0007（Capacitor）、ADR-0008（iOS の作法と自前の見た目、スプラッシュ）、ADR-0009（つながり。下の 9 節の分を追記した）、
  ADR-0010（便箋と押し葉。動きの値と地の色の分だけ上書きする）、wireframes 0〜4 節・6 節・7 節・第8節 #29・第9節、architecture 5.15、setup-capacitor 4 節・7 節

## 経緯

11/7、開発者の言葉:

> 全体ブラッシュアップ / まずはiPhoneでしか使わないし、iPhoneに全特化で最適化を / 動きをしっかりつけ / 単調にならないように / そして、つい記録したくなるようなものにして。

共通の約束を先に 3 つコミットした（8365d9c: 触覚と鍵盤のプラグインと `haptics.ts`、受け持ちごとの CSS の置き場 / 01cda3a: `season.ts` と `keyboard.ts` /
377cc60: 動きのトークンと `.press`）。その上で 5 つの受け持ちが並行で作った。

| 受け持ち | 中身 | 主なファイル |
|---|---|---|
| platform | iPhone の土台（鍵盤、長押し・拡大・選択、明るい表示と縦だけ、アイコン） | `capacitor.config.ts`、`native.ts`、`styles/platform.css`、`index.html`、`Info.plist`、`AppIcon.appiconset` |
| motion | 画面の移り変わり、S3 をなぞって戻る、シート、押したときの沈み、届いた札 | `App.vue`、`motion.ts`、`composables/useEdgeSwipe.ts`・`useSheetDrag.ts`、`style.css` の後半 |
| today | S1 を「つい書きたくなる」画面に（問いかけ、このごろ、あの日のひとこと、残した瞬間、待つ間、写真の札） | `TodayScreen.vue`、`components/today/`、`styles/today.css`、`FactChips.vue`、`PhotoPicker.vue`、`worker/src/routes/today.ts` |
| connections | S5 の見直しの直し、動き、帯を押す、新しく結ばれた糸 | `ConnectionsScreen.vue`、`components/connections/`、`styles/connections.css` |
| season | 季節の押し葉と封蝋、時間帯の紙 | `components/motifs/Leaf.vue`・`Seal.vue`、`season.ts`、`styles/season.css` |

あわせて、3 回目の見直しで確かめた 19 件（下の「見直しの直し」）を直した。

## 決めたこと

### 1. 相手は iPhone だけ

- 画面は iPhone の縦（402 × 874pt。iPhone 16 Pro / 17）で作り、375pt でも崩さない。iPhone は縦だけにした（`Info.plist` の `UISupportedInterfaceOrientations`。iPad の項目はそのまま）。Xcode の対象機種も iPhone だけにした（`project.pbxproj` の `TARGETED_DEVICE_FAMILY = 1`。以前は iPad を含む `"1,2"`）
- **Android はビルドが通る状態を保つ**（`cap sync`、`./gradlew assembleDebug`）。**Android 向けの調整（アイコン、鍵盤、ステータスバー、戻るボタン）はしない**。
  `capacitor.config.ts` と `native.ts` の冒頭にも同じことを書いた
- 明るい表示に固定する（ダークモードは元から作らない。ADR-0004）: `Info.plist` の `UIUserInterfaceStyle = Light`、鍵盤の `style: LIGHT`、`index.html` の `color-scheme: light`。
  端末が暗い表示でも、鍵盤・日付の選択・写真の選択・ステータスバーが明るい紙に合うことを Simulator で確かめた

### 2. 足した依存（どちらも 8365d9c）

| 依存 | 何に使うか | 無いと困ること |
|---|---|---|
| `@capacitor/haptics`（^8.0.2） | `web/src/haptics.ts` が手ざわりの名前で触覚を呼ぶ（下の 3 節）。Web では何もしない | iOS の WebView には Vibration API が無く、画面の側から Taptic Engine を鳴らせない |
| `@capacitor/keyboard`（^8.0.6） | 鍵盤の出入りと高さを画面に知らせる（`keyboard.ts`）、付属バー（「完了」）、鍵盤の色、鍵盤の脇に見える窓の地（下の 4 節） | 下部ナビを鍵盤の間だけ隠す・「保存する」を鍵盤の上に置く、の手がかりが無い。付属バーと鍵盤の色を決められない |

ほかの受け持ちは依存を足していない（動きは CSS と数十行の composable、アイコンは headless Chrome で描いた PNG）。
SPM は `ios/App/CapApp-SPM/Package.swift` に 2 つが入っている（`cap sync` が書く。`node_modules` の中を指すので `Package.resolved` は変わらない）。

### 3. 触覚の鳴らし方（`web/src/haptics.ts`）

- 画面からは手ざわりの名前の 6 つだけを呼ぶ。プラグインの失敗は無視する（触覚が無くても操作は成り立つ）。Web では何もしない
- **鳴らすのは利用者が押した直後だけ**。読み込みや取り直しのような、手を離れた出来事では鳴らさない。例外は、待っていた札が届いたとき（`arrive`）だけ
- いまの画面の項目をもう一度押した、組を押してシートを開いた、のような「何も変わらない」操作では鳴らさない

| 名前 | Capacitor | 鳴らす所 |
|---|---|---|
| `tap` | `impact` Light | 候補の「ちがう」。S3 の札と S5 のシートの「関係ないかも」と、反応の取り消し（同じボタンをもう一度）。写真の札 / 「写真を添える」「写真を変える」と「はずす」（`PhotoPicker`） |
| `select` | `selectionChanged` | 下部ナビで画面が変わるとき（S3 からは元の画面へ戻るので鳴らす）。「いつ？」の精度を切り替えたとき。S3 を左端からなぞって戻れたとき。S5 の帯の弧を押したとき |
| `stamp` | `impact` Medium | 候補の「そう」。札の「そうだった」（S3 はまだ「そうだった」でないとき、S5 は押したあと「そうだった」になるとき） |
| `saved` | `notification` Success | S1 で残せて保存後の便箋に替わるとき。S3 で写真を添えられたとき |
| `arrive` | `impact` Light | S1・S3 で「そういえば。」の札が届いたとき。封蝋がいちばん沈む 560ms 後（`motion.ts` の `SEAL_IMPACT_MS`）に、同時に何枚届いても 1 回。動きを付けない札（戻ってきたとき）と「関係ないかも」の札では鳴らさない。届く前に札が全部外れたら鳴らさない。動きを減らす設定では待たずに鳴らす |
| `failed` | `notification` Warning | S1 の保存の失敗、候補の記録の失敗、S3 の札の記録・写真・削除の失敗、S5 の記録の失敗、S0 のログインの失敗 |

`TodayScreen` は `arrive` を呼ばない（`RecallCard` が呼ぶので、呼ぶと 2 回鳴る）。

### 4. 鍵盤

- **`resize: native`**（`capacitor.config.ts`。見直し n=10）。プラグインは読み込んだ時点で、どの方式でも WKWebView 自身の鍵盤の通知の購読を外す（プラグイン 8.0.6 の `ios/Sources/KeyboardPlugin/Keyboard.m` 197〜200 行の `removeObserver:self.webView`）。付属バーも読み込みで消す（同 188 行の `hideFormAccessoryBar = YES`）。
  `none` では書いている行を鍵盤の上へ送るものが無くなり、`body` では body の高さだけが変わって `min-h-dvh` の中身がはみ出す。
  `native` は WKWebView の枠が縮み（`100dvh` も縮む）、書いている行は WebKit が見える位置へ送る（Simulator で 10 行書いて確かめた）
  - 測った値（iPhone 17 / iOS 27.0 の Simulator、かな鍵盤と「完了」の帯）: `keyboardHeight` 404、WebView 874 → 470pt。
    枠が縮むのは `keyboardWillShow` から（鍵盤の動きの時間 + 0.2 秒）あと、戻るのは `keyboardWillHide` から 0.01 秒あと（プラグインの作り）
- **鍵盤が出ている間は下部ナビを隠す**: `styles/platform.css` が `html[data-keyboard="open"] nav[aria-label="画面の切り替え"]` を `display: none` にする。
  隠さないと、縮んだ枠の下端（鍵盤のすぐ上）に帯が出て、`env(safe-area-inset-bottom)` が 0 になるので高さも 96px → 68px に変わる（wireframes 第8節 #23 の「高さが変わらない」を鍵盤の間も守る）。
  閉じるとふだんの高さ（`pt-1` + 58px + `max(env(safe-area-inset-bottom), 6px)` = 96px）に戻る
- **`keyboard.ts` の約束**: `native.ts` の `setupNative` が `keyboardWillShow` で `setKeyboard(高さ > 0, 高さ)`、`keyboardWillHide` で `setKeyboard(false, 0)` を呼ぶ。
  `setKeyboard` は `<html data-keyboard="open">` と `--keyboard-height`（px）を付け外しし、部品は `useKeyboard()` の `open` / `height` で知る。
  高さ 0 の「出る」（外付けの鍵盤で予測の帯だけが出るとき）は閉じている扱い。`--keyboard-height` は約束どおり入れるが、platform では余白に使わない（`native` では枠がもう縮んでいる）
- **付属バー（∧ ∨ 完了）を出す**: `Keyboard.setAccessoryBarVisible({ isVisible: true })`。プラグインは読み込みで付属バーを消すので、8365d9c 以来「完了」が無かった。
  便箋は `textarea` で改行のキーは改行を入れるだけなので、「完了」が無いと閉じる手段が「書いていない所を押す」しか無い
- **スクロールで鍵盤を閉じる動きは付けない**: WKWebView の `keyboardDismissMode` は Capacitor の設定から変えられず（ネイティブの継承が要る）、WebKit が書いている行を送るときのスクロールと区別できない
- 鍵盤の見た目: `style: LIGHT`（端末が暗い表示でも明るい鍵盤）、`autoBackdropColor: "auto"`（枠が縮む間と、角の丸い鍵盤の脇に見える窓の地を `backgroundColor` の `#FAF5EC` にする。既定の off では塗られない）
- S1 の「保存する」は鍵盤の上に貼り付ける（today。`styles/today.css` の `.today-save`。下の 8.4）。Simulator で 462 < 470pt、鍵盤の上に出ることを確かめた
- **入力欄の文字は 16px 以上**（16px 未満だと iOS が入力欄を拡大する）。CSS の下限では強制せず、`web/test/platform.test.ts` が `.vue` の `input` / `textarea` / `select` に `text-xs` / `text-sm` / 16px 未満の指定が無いことを見張る。いまは全部 17px

### 5. iPhone の手ざわり（platform）

- 長押しのリンクの下見を切る（`ios.allowsLinkPreview: false`）。札（`RecallCard`）は札全体がリンクなので、引用を長押しすると `capacitor://localhost/#memory/…` の下見が開いていた
- 拡大と弾む動き（ゴムの伸び）は Capacitor の既定で切れている（`zoomEnabled = false`、`scrollView.bounces = false` の決め打ち）。
  ダブルタップの拡大だけは `touch-action: manipulation` で止める（Web の開発でも同じ手ざわりにする）。`user-scalable=no` は使わない
- タップの灰色の光は消す（`-webkit-tap-highlight-color: transparent`。押した手ごたえは `.press` の沈みと触覚で返す）
- 長押しのメニューと選択を止めるのは押すもの・絵・写真だけ（`a`、`button`、`nav`、`svg`、`img`、`[role="button"]`）。本文・引用・日付・候補は選べてコピーできる。
  `label` は入力欄を包むので入れない。`a` と `img` は持ち上げて引きずる動きも止める
- `index.html`: `color-scheme: light`、`format-detection: telephone=no, date=no, address=no, email=no`（書いたひとことの数字を電話のリンクにしない）
- `Info.plist`: `UIUserInterfaceStyle = Light`、`UIStatusBarStyle = UIStatusBarStyleDarkContent`（起動画面の間の時計も濃い文字）、iPhone は縦だけ
- 地の色は `html` とアプリの `backgroundColor` が `#FAF5EC` で揃っているので足していない。弾む動きを戻すには `CAPBridgeViewController` の継承が要り、今回はしていない

### 6. 動きの共通の約束（`web/src/style.css`、`web/src/motion.ts`）

- **動かすのは `transform` と `opacity` だけ**（iPhone で 60fps を保つ）。色・`stroke-dashoffset`・高さは動かさない
- **`prefers-reduced-motion: reduce` では動きを止め、状態だけを切り替える**（待ちも入れない。シートは待たずに閉じ、なぞりは指に付いてこない）
- 速さと曲線はトークンの名前でそろえる。JS で待つ時間は `motion.ts` の `DURATION`（同じ数）から取る

| トークン | 値 | 使う所 |
|---|---|---|
| `--ease-spring` | `cubic-bezier(0.34, 1.36, 0.64, 1)`（少し行きすぎて戻る） | シート、届いた札の封蝋以外の弾み、判、押して離したときの戻り |
| `--ease-out-soft` | `cubic-bezier(0.22, 1, 0.36, 1)`（すっと止まる） | 画面の出入り、一覧が現れる、沈む |
| `--duration-quick` | 160ms | 押したときの沈み、出ていく画面の薄れ |
| `--duration-base` | 280ms | 画面の出入り、切り替え、閉じる |
| `--duration-slow` | 460ms | シートが上がる、届く・現れる動き |

`--ease-gentle`（ADR-0004）は、まだ置き換えていない古い動きのために残している。

- **押したときの沈み `.press`**（`@utility press`）: 指が触れている間だけ `scale(0.97)` に沈め（160ms、`ease-out-soft`）、離すとばねで戻す（280ms、`ease-spring`）。
  付けた所: 下部ナビの項目、S2 の行（`MemoryCard`）、札（`RecallCard`）全体、S5 の組（`PairCard`）全体、あの日のひとこと、S1 の「保存する」、S0 の「はじめる」、
  S3 の戻る・「もう一度」・「消す」、「消しますか」の「消す」「やめる」、S2・S5 の「もう一度」、S2 の「もっと前を見る」、シートの「とじる」、写真の札。
  小さな選択 `.choice`（そう / ちがう / そうだった / 関係ないかも / 精度）は色の移り変わりを消さないよう `.press` を付けず、自分の `:active` で `scale(0.96)` に沈む
- iPhone の WebKit は、どこにも `touchstart` の受け手が無いと `:active` を付けない。`App.vue` が何もしない受け手（passive）を `document` に置く
- `motion.ts`: `DURATION`、`prefersMotion()`（`matchMedia` の無い所では false）、`arriveSoon` / `cancelArrive`（3 節の `arrive`）、`pinLeaving` / `unpinLeaving`（下の 7 節）

### 7. 画面の移り変わりとなぞり（motion）

**移り変わり**（`App.vue` の `<Transition name="screen-<motion>">`。向きは `useScreen.ts` の `motionBetween` が hashchange のたびに画面より先に決める）

| 動き | いつ | 入ってくる画面 | 出ていく画面 |
|---|---|---|---|
| `forward` / `backward` | 下部ナビの並び（きょう → これまで → つながり）で右の画面へ / 左の画面へ | 28px 横から 280ms で滑りながら現れる（`ease-out-soft`） | 反対へ 28px 動きながら 160ms で薄れる |
| `push` | S3 をひらく（S3 から札の相手の S3 へも） | S3 の紙が右（`100vw`）から 280ms で入る | 280ms で `translateX(-30%)` まで下がり、薄い墨（`ink` の 0.12）が重なる |
| `pop` | S3 から開いた元の画面へ戻る（戻るボタン、下部ナビの同じ項目、S3 から S3 へ戻る） | push の逆 | push の逆 |
| `swipe` | S3 を左端からなぞって戻った | -24px から 280ms でふわっと現れる | S3 は指の位置から右へ 280ms で出ていく（なぞりの続き） |
| `none` | 最初の表示 | 動かさない | — |

- S3 から下部ナビで別の項目へ行くときは、開いた元の画面からの左右（`forward` / `backward`）。S3 で消して S2 へ行くときも同じで、開いた元が S2 なら `pop`、S1 / S5 なら元の画面から S2 への左右
- push / pop は iOS の約 350ms ではなくトークンの base 280ms にした（トークンの注釈で base を画面の出入りに当てている）
- 出ていく画面は、hashchange の前に見ていた位置のまま `position: fixed` で留める（`pinLeaving`。hashchange の時点で位置はもう 0 に送られているので、その前の `scrollY` から出す）。
  `inert`、`aria-hidden`、`data-leaving` を付けて読み上げと指から外し、見出しの探し先は `main:not([data-leaving]) h1` にした（`focusScreenHeading`。`useScreenFocus.test.ts` の期待値もそのために変えた。弱めていない）
- 動いている間の S3 は、左右の余白まで地の紙（机の手ざわり）を敷き、左の縁に影（`--shadow-page`）を落とす（下の画面の文字を透かさない）
- `MemoryDetailScreen` は記憶の id ごとに作り直す（`:key`）。そのため既存の `watch(props.id)` は動かなくなったが害は無い
- `.safe-area` に `overflow-x: clip`（横から入ってくる画面で横のスクロールを出さない。`clip` はスクロールの箱を作らないので下部ナビの `sticky` は効いたまま）と
  `touch-pan-y` + `touch-pinch-zoom`（横へなぞっても WebKit がスクロールを始めない）
- 位置の戻し、第8節 #23（下部ナビの高さ）、`h1` へのフォーカスは変えていない。動きを減らす設定と最初の表示では `css` を切り、待たずに入れ替える

**S3 を左端からなぞって戻る**（`useEdgeSwipe.ts`。「消しますか」のシートが出ている間は拾わない）

- 画面の左端 24px の中で触れ、10px 動いたところで向きを決める。縦が先（か左へ）ならこの指はもう拾わず、スクロールに任せる。向きが決まるまでも横向きの動きは止める（iPhone は最初の `touchmove` を止めないと、あとから止められない）
- 拾ったら S3 の紙が指に付いて右へ動く。下に見えるのは机の地で、前の画面ではない（前の画面は `KeepAlive` に仕舞われていて、ここでは描けない）。戻ると決まってから前の画面が現れる
- 離したとき: 右へ 0.3px/ms 以上で 24px 以上払った、または幅の 50% より右なら戻る。左へ 0.3px/ms 以上で払ったら戻らない。速さは終わりの 80ms から
- 戻るときは `select` の触覚。戻らないときは 280ms で元の位置へ。動きを減らす設定では紙を動かさず、右へ 32px なぞった時点ですぐ戻る

**下からのシート**（`useSheetDrag.ts`。DateSheet、S3 の「消しますか」、S5 のシート）

- 紙はばねで上がる（460ms、`ease-spring`、行きすぎは約 4%）。後ろの地は 280ms でふわっと暗くなる（`bg-ink/30`）。上に掴み手（40 × 4px、`line-strong`）
- 掴み手かシートを下へなぞると、指に付いて下がる（上へは少したわむだけ）。8px 未満の動きは押しただけとみなす（中のボタンは押せる）
- 離したとき: 下げた量が `min(シートの高さ × 0.3, 140px)` を越えた、または下へ 0.5px/ms 以上で 16px 以上払ったら閉じる。上へ速く払ったら戻す。それ以外は 280ms のばねで戻る
- 閉じ方は 4 つ（地を押す、「とじる」/「やめる」、Esc、下へなぞる）で、どれも 280ms（`ease-out-soft`）で下がってから閉じる。動きを減らす設定では待たずに閉じる
- 開いている間は後ろの画面をスクロールさせない（置き場 `.sheet-host` の `touch-action: none` と、`touchmove` / `wheel` の `preventDefault`。`html` の `overflow` は触らない）。
  中身がスクロールするシートは、スクロールする要素に `data-sheet-scroll` を付ける（縦だけ任せ、その要素がいちばん上にあるときだけシートが下がる）
- class は `.sheet-host` / `.sheet-paper` / `.sheet-backdrop` / `.sheet-grip`（S5 の古い `.sheet-panel` / `.sheet-scrim` とは別の名前）

**小さな動き**

- 届いた札（`RecallCard`、`.note.appear`）: 一筆箋が下から 18px、460ms ですべり込み（`ease-out-soft`。終わりの形を持たないので、そのあと `.press` が効く）、
  封蝋は 360ms 待って 400ms で押される（`seal-press`: scale 1.4 → 0.94 → 1、`ease-out-soft`）。ADR-0010 の値（600ms・8px、380ms 待って 420ms、1.25 → 1）を上書きした。
  札以外の `.appear`（あの日のひとこと）は 600ms・8px のまま。S3 では、開いたあと取り直しで届いた札だけ動かす
- S3 の「そうだった」（`RecalledByCard`）: 判が少し浮いて押し当てられる（`.recall-stamp`: 280ms、1.1 → 0.95 → 1、`ease-spring`）
- S2: 読み込めて一覧を初めて出すときだけ、上の行から順に、10px 下から 460ms で浮かんで現れ、50ms ずつずれる（5 行目まで。6 行目からは 5 行目と一緒）。戻ってきたとき・「もっと前を見る」で足した行は動かさない
- 写真（`PhotoImg`）: 読めるまでは透明で、読めたら 460ms でふわっと出る（`.photo-develop`。S1 の `.photo-print` と別の名前）
- 下部ナビ: 選んだ項目の淡い地が 0.82 からばねで少しふくらんで落ち着く（`.nav-pill-on`、280ms）
- S0: 題・入力の便箋・添え書きが上から順に、10px 下から 460ms で浮かんで現れる（`.rise-in`、`--i` は 0 / 2 / 4 で 0 / 100 / 200ms ずれる）

### 8. 「つい記録したくなる」仕掛け（today、connections）

**方針: 急かさない・比べない・責めない。** 書く理由を作るのではなく、書くきっかけと、書いたことの手ごたえだけを置く。

- 続けた日数（連続記録）を数えない・出さない。書かなかった日に触れない（このごろの空いた日は、地に溶けかけた薄い枠だけ）
- 「書いてください」「きょうはまだです」と言わない。問いは入力欄の placeholder に置くだけで、答えなくてもよい
- 目標・達成・バッジ・通知は置かない。数は「N こめのひとこと」（自分が残した数）だけで、多い少ないを言わない
- 無い日は何も言わない（あの日のひとことが無い、札が届かない。原則 2。「見つかりませんでした」と言わない）
- 見ている間に言葉を替えない（問いかけは、戻ってきたとき・アプリが表に戻ったとき・「もうひとつ書く」のときだけ選び直す）

#### 8.1 問いかけ（`web/src/components/today/prompts.ts`。全 47 の言葉。本書が正）

日付の見出しの下に小さなあいさつ、入力欄の placeholder に問い。入力欄の名前（`sr-only` の label「きょうのひとこと」）は替えない（読み上げで欄の名前が日替わりにならない）。

| 束 | 朝（5〜10 時） | 昼（11〜16 時） | 夕（17〜20 時） | 夜（21〜4 時） |
|---|---|---|---|---|
| あいさつ | おはようございます。 / けさは、どんな朝でしたか。 / ゆっくり、はじめましょう。 | こんにちは。 / ひと息つくあいだに、どうぞ。 / おひるの、すきまに。 | おかえりなさい。 / きょうも、おつかれさまでした。 / 夕方の、ひとやすみに。 | こんばんは。 / きょうのおわりに、すこしだけ。 / おやすみの前に、ひとこと。 |
| 問い | けさ、目に入ったものは？ / 朝ごはんは、なんでしたか？ / 起きてすぐ、思ったこと / けさの空は、どんな色でしたか？ | きょう、だれかと話したこと / おひるに食べたもの / きょう、ちょっとうれしかったこと / いま、窓の外に見えるもの | 帰り道に見たもの / きょう、いちばん笑ったこと / 夕方の空のこと / きょう、手にとったもの | きょう、心に残ったこと / ねる前に、思い出すこと / きょう会った人のこと / きょうの、小さなできごと |

| 束 | 春（3〜5 月） | 夏（6〜8 月） | 秋（9〜11 月） | 冬（12〜2 月） |
|---|---|---|---|---|
| 季節のあいさつ | 日がのびてきましたね。 / あたたかくなってきました。 | 暑い日がつづきますね。 / 夕立のにおいの季節です。 | 日がみじかくなってきました。 / 空が高い季節ですね。 | 息が白い季節ですね。 / あたたかくして、どうぞ。 |
| 季節の問い | 見かけた花のこと / 春になって、はじめてしたこと | すずしかった場所のこと / 夏の音で、聞こえたもの | 色づいてきたもの / 秋の味で、食べたもの | あたたかかったもの / 冬の空気で、思い出したこと |

いつでもの問い: ふと思い出した、むかしのこと / きょうのにおいのこと / なんでもない、きょうのこと

選び方（乱数を使わない。どれも Asia/Tokyo）: `band` = 朝 0・昼 1・夕 2・夜 3、`daySeed` = 年 × 372 + 月 × 31 + 日（`season.ts`）。

- あいさつ = （時間帯の 3 + 季節の 2）の `(daySeed + band × 2) mod 5` 番目
- 問い = （時間帯の 4 + 季節の 2 + いつでもの 3）の `(daySeed × 7 + band × 3) mod 9` 番目
- 同じ日の同じ時間帯なら何度開いても同じ。朝と夜では替わる

#### 8.2 このごろ（`DayLeaves.vue`）

- 書く画面の「保存する」の下に、きょうを右端にした 7 日分の小さな枠（きょうの枠は 1.7 倍の幅）。見出しは「このごろ」（14px、`h2`）
- 書いた日（`created_at` の Asia/Tokyo の日付）は押し葉が押してある（24 × 32。楕円 / 丸 / 細い / 桂のハート形の 4 つから、日付の文字列のハッシュで決める。同じ日はいつも同じ形）。
  色は季節のトークン（春 `sakura`、夏 `aomomiji`、秋 `momiji`、冬と無いときは `leaf` / `moss`）
- 書いていない日は地に溶けかけた薄い枠だけ。きょうがまだなら点線の枠に「ここに」。枠の下は曜日、きょうは「きょう」
- 読み上げ: 「11月5日（水）、書いた日」/「11月4日（火）」/「きょう、11月7日（土）、これから」（書いたら「きょう、11月7日（土）、書いた日」）
- きょう初めて残したあと「もうひとつ書く」で戻ると、きょうの押し葉が上から押される（460ms、`ease-spring`、1.3 → 0.92 → 1）。このごろとあの日のひとことは、保存のあとや戻ってきたときに現れる動きをやり直さない

#### 8.3 あの日のひとこと（`ThatDayLetter.vue`、`GET /api/today`）

- 去年以前の同じ日付のあたりの記憶を、書く画面のいちばん下に、折りたたんだ便箋で 1 つだけ出す。無い日は何も出さない
- 選び方（Worker。`worker/src/routes/today.ts`。その日のうちは変わらない）:
  1. 日の候補: 起きた日が day 精度で、月日がきょうの前後 3 日（年末年始をまたぐ。うるう年でない年に 2/28 と 3/1 が両方入るときは 2/29 も）、起きた日が「1 年まえのきょう + 3 日」以前。
     並びは きょうとのずれの小ささ → 新しい年 → id
  2. 日の候補が無ければ月の候補: 起きた日の月がきょうと同じで年が去年以前の、**day 精度と month 精度**の記憶。並びは 新しい年 → 日のずれの小ささ（day 精度。month 精度はその後）→ id
  3. どちらも、きょう書いた記憶（`created_at` がきょうの Asia/Tokyo の 0 時以降）は出さない（昔の日付で書いた記憶が、保存した直後にそのまま返ってこないように）
- 見出し: 同じ月日「N年まえの、きょう」、前後 3 日「N年まえの、きょうのころ」、同じ月「N年まえの、いまごろ」。その右に起きた日、下に本文の 1 行目を明朝で 1 行。
  折り目から下は折り返した裏（`slip` の色）に「ひらく ›」。全体が `#memory/<id>?from=today` へのリンク
- 月の候補に day 精度を含めたのは判断: 指示は month 精度だけだったが、そのとおりだと seed では 11/10 のデモで何も出ない。戻すなら `worker/src/db/memories.ts` の
  `listThatDayMonth` の `IN ('day','month')` を `= 'month'` にする（1 か所）
- 「きょう」と 7 日分は Worker が Asia/Tokyo で決める（端末の時計がずれていても並びがずれない）

#### 8.4 残した瞬間（S1）

| 時刻 | 起きること |
|---|---|
| 押した瞬間 | 書いた便箋が封をされるように沈む（`translateY(3px) scale(.985)`、160ms、`ease-out-soft`）。返事が来るまでそのまま、ただし最短 280ms（動きを減らす設定では待たない） |
| 400ms〜 | 保存に時間がかかるときだけ「残しています」（`role="status"`、280ms で現れる） |
| 返事が来た | `saved` の触覚と一緒に、保存後の便箋が沈んだ形から浮かんで収まる（280ms） |
| +180ms / +330ms | 「残しました」の横に手書きの ✓（1 画目 150ms、2 画目 230ms。画ごとに `scaleX` で左から伸ばす） |
| +560ms | 「N こめのひとこと」が 280ms で現れる（N は `GET /api/today` の総数 + 1 をその場で出し、読み直しで合わせる。その便箋の間は替えない） |
| 候補が届いた | ミシン目の下から控えがすべり出し（`translateY(-100%)` → 0、460ms）、候補が 220ms + 70ms × 行 から 1 行ずつ 6px 上がって現れる（各 280ms） |

写真を選んだときは、焼き付けのプリントが上から置かれる（`translateY(-10px) scale(1.04)` → 0、460ms、`ease-spring`）。

#### 8.5 札を待つ間（`WaitingThread.vue`）

- 保存のあと取り直している間、札がまだ 1 枚も無く札の `pending` が false と分かっていない間だけ、控えの下に「思い出しています」（`role="status"`）と、しつけ糸の目が 1 つずつ縫われていく小さな動き
  （5 目、2.8 秒で 1 巡、260ms ずつずれる）。600ms 待ってから 460ms で現れるので、すぐ終わるときは見えない
- 札が届いたらすぐ札に入れ替わる（札の現れる動きと `arrive` は 7 節のとおり）。届かずに終わったら（`pending` が false、か 30 秒の打ち切り）何も言わずに 280ms で薄れて消える
- wireframes 2.6 の「ユーザーは待たされていることに気づかない」とは食い違うので、2.6 を書き直した。待っていることは見せるが、失敗は見せない（2.6 の「失敗時: 画面には何も出さない」は守る）

#### 8.6 候補の判と打ち消し線、写真の札（S1・S3）

- 「そう」: 押した瞬間に `stamp`。判が 1.16 → 0.94 → 1 で押される（460ms、`ease-spring`）と同時に、輪が 1 → 1.32 に広がって消える（520ms、140ms 遅れ）
- 「ちがう」: 押した瞬間に `tap`。打ち消し線が左から引かれる（280ms）。打ち消し線は 1px から 1.5px に太くした（細いと漢字の上でほとんど見えない）
- 印はこの操作で決めた行だけに付け、700ms で外す（静止した判 / 打ち消し線に戻る）。記録に失敗したら `failed` と一緒に印も外す
- S1 の写真は便箋の下の段のカメラの札（`PhotoPicker` の `variant="letter"`）。添えた写真は 112 × 84 の白いふちのプリント。S3 は今までの副ボタンのまま（`variant="button"`）。どちらも見直し n=9/16、14、15 の直しが効く

#### 8.7 S5: 新しく結ばれた糸が見える

- 押し葉も「N 本の糸」も入れない。帯は情報の図なので飾りが並ぶと読みにくい。数は API が組を新しい 50 までしか返さないので、それを超えると嘘になる（総数には Worker の変更が要る）
- 代わりに、**前に見たときより後に結ばれた組（と帯のその弧）だけが、戻ったときに同じ動きで現れて糸が渡される**。自分が書くと糸が増えることが目で見える
- 動きの値は wireframes 9.7 と ADR-0009 の追記

### 9. 季節と時間帯の紙（season）

- 季節と時間帯は `season.ts` が Asia/Tokyo の暦と時刻で決める（端末の時刻設定が UTC などでも日本の季節・時間帯）。
  季節: 春 3〜5 月 / 夏 6〜8 月 / 秋 9〜11 月 / 冬 12〜2 月。時間帯: 朝 5〜10 時 / 昼 11〜16 時 / 夕 17〜20 時 / 夜 21〜4 時
- **押し葉 `Leaf.vue`**（58 × 34。S1 の札の左下と S2 の見出しの右）: どれも左下から右上へ伸びる同じ構図
  - 春 = 桜の小枝（花 2 つとつぼみ。面 `sakura`、縁と芯 `sakura-deep`、枝 `bark`）
  - 夏 = 青もみじの小枝（5 裂の若い葉 3 枚。面 `aomomiji`、縁・葉脈・枝 `moss`）
  - 秋 = 紅葉（7 裂の葉が大小 2 枚。面 `momiji`、縁・葉脈・葉柄 `momiji-deep`）
  - 冬 = 南天（細い葉 3 枚は面 `leaf` と縁 `moss`、実 5 つは面 `nanten` と縁 `nanten-deep`、実のつやは `card`、枝 `bark`）。椿にしなかったのは、赤い実で冬とすぐ分かり、線画でも読めるため
- **封蝋 `Seal.vue` の浮き出しの線画**（`seal-emboss`、線 1.15。内側の輪（半径 10.4）に触れないよう中心から 9px 以内）: 春 = 切れ込みのある桜の花と芯 / 夏 = 5 裂の青もみじを立てて葉柄を下へ /
  秋 = 7 裂の紅葉を傾けて葉柄を左下へ / 冬 = 南天の実 3 つと房の軸と葉 1 枚。蝋の外形、輪 2 本、押される動きは変えていない
- どちらも `season?: 'spring' | 'summer' | 'autumn' | 'winter'`。渡さなければ今日の季節（`seasonOf()`）。ルートの `svg` に `data-season`。`aria-hidden="true"`、`focusable="false"`。
  季節は描いたときに決まり、`KeepAlive` で残っている画面は月をまたいでも次に描くまで替わらない。今の呼び出し（`RecallCard`、`TimelineScreen`、`RecalledByCard`、`PairSheet`）は手を入れずに動く
- 日替わり（`daySeed`）の変化は押し葉に入れない（形は季節ごとに 1 つ）。回転や散らした飾りも入れない（ADR-0010 のとおり）
- 季節の色のトークン（`styles/season.css` の `@theme`。どれも飾りで、文字の後ろには敷かない）: `sakura` #EED5D0、`sakura-deep` #BC8A84、`bark` #9F8877、`aomomiji` #D2DFC4、
  `momiji` #E4B5A0、`momiji-deep` #A9644E、`nanten` #C77B6F、`nanten-deep` #97493F

**時間帯の紙**

- `season.ts` の `applyTimeOfDay()` が `<html data-time="morning|day|evening|night">` を付け、1 分ごとと `visibilitychange`（前に戻ったとき）で見直す。返り値は止める関数。
  `main.ts` で mount より前に一度呼ぶ約束（**まだ呼ばれていない。下の「まだのこと」**）
- 夕方は `--color-paper` を `paper-evening` #FFF4E7（夕焼けの少し赤み）に、夜は `paper-night` #FEF5E0（灯りのクリーム色）に差し替える。朝と昼は #FAF5EC（`paper-day`）のまま。
  body の地だけでなくトークンそのものを替えるので、`paper` を使う所（body、html、ミシン目の切り欠き、下部ナビ、上のセーフエリアの帯、シート、`note-quiet`、糸の端）はすべて一緒に替わり、継ぎ目が出ない
- 便箋（`card`）・一筆箋（`letter`）・控え（`slip`）は変えない。起動の絵（`SplashOverlay` の `.splash`）は `paper-day` に固定する（ネイティブの起動画面と入れ替わる瞬間に色の段を出さず、消えるときに時間帯の地へ溶ける）。
  ネイティブの起動画面と `capacitor.config.ts` の `backgroundColor` も #FAF5EC のまま
- 色の `transition` は付けない（6 節の約束）。17:00 と 21:00 に地が一度に替わる。`data-time` は 4 つとも付くが、CSS を当てるのは evening と night だけ
- コントラスト（WCAG 2.x の相対輝度。地 `paper` の上。朝・昼 / 夕方 / 夜）: `ink` 11.52 / 11.52 / 11.53、`ink-soft` 5.89 / 5.89 / 5.89、`ember-ink` 4.28 / 4.28 / 4.28、
  `moss-deep` 4.53 / 4.53 / 4.53、`ember` 3.48 / 3.48 / 3.48。相対輝度は 0.9168 / 0.9173（+0.05%）/ 0.9176（+0.08%）で、色相だけを動かしたので比は下がらない。
  朝・昼との差は OKLab × 100 で 夕方 0.84 / 夜 1.62
- **ADR-0010 の「地は #FAF5EC のまま」に、夕方と夜の例外ができた**。今後足す部品で、地に合わせたいものは `bg-paper` / `var(--color-paper)` を、起動画面の色に合わせたいものは `paper-day` を使う

### 10. アイコン

- 「便箋と押し葉」の言葉で 3 案を描いた: A「封蝋」/ B「便箋と押し葉」/ C「そ。」。**A を選んだ**（ADR-0008 の「まだのこと」を閉じる）
  - A: 紙の地（#FAF5EC にごく淡い繊維）に、朱の封蝋を 1 つ置いた絵。蝋は `seal-light` → `ember` → `seal-deep` の放射状のグラデーション（`Seal.vue` と同じ形）。中に浮き出しの輪と、押した葉（`seal-emboss`）。
    29pt でも朱の丸と白い葉が残り、札の封蝋・favicon・スプラッシュの朱の「。」と続いて見える
  - B は 29pt で小枝が線になって消える。C は字が名前のラベル（そういえば。）と重なる
- 素材は使っていない。SVG をその場で書き、headless Chrome で描いて PNG にした
- `ios/App/App/Assets.xcassets/AppIcon.appiconset/`: `AppIcon.png`（1024 × 1024 の不透明な RGB。透明があると App Store に断られる）、
  `AppIcon-dark.png` / `AppIcon-tinted.png`（地が透明。iOS 18 以降の暗い表示と色付きの表示）。旧 `AppIcon-512@2x.png`（Capacitor の既定）は消した。
  `web/test/platform.test.ts` が大きさ・不透明・ファイルの有無を見張る
- Android のアイコン（`android/app/src/main/res/mipmap-*`）は Capacitor の既定のまま（1 節）

### 11. 見直しの直し（3 回目、19 件）

| n | 直したこと | 受け持ち |
|---|---|---|
| 1, 2, 4 | S5 で一覧を読むことと反応の記録が重なったときの約束（ADR-0009 の追記）。失敗して戻すときは、いま画面にある組を id で探す | connections |
| 3, 8 | シートを閉じたあとに記録が失敗したら、組の足に「記録できませんでした」と読み上げの知らせ、`failed` | connections |
| 5 | 一覧の引用の切り分けを 80 字から 56 字に。前の文脈は「…」+ 前 + 引用 が 56 字に収まるまで縮める | connections |
| 6 | 「関係ないかも」の札が S1 と S3 の `RecallCard` で封蝋付きのまま出ていた → `.note-quiet` で封蝋と押し葉を外す（見出しと「ひらく ›」はそのまま） | motion |
| 7 | 引用の印を色だけに頼らない（朱の点線の下線、読み上げ用の「」） | connections |
| 9, 16 | 「はずす」でフォーカスが落ちる → キーボードや読み上げで押したときだけ写真のボタンへ戻す | today |
| 10 | 鍵盤で下部ナビの高さが変わる → 鍵盤の間はナビを隠す（4 節） | platform |
| 11 | S5 のシートを開いている間も後ろがスクロールした → `useSheetDrag` に載せ替え | connections |
| 12 | 写真が一度失敗すると取り直さない、S2 の 56px の枠に文言がはみ出す → 戻ったときと `online` で取り直し、S2 は空の枠（`quiet`） | motion |
| 13 | S3 で写真を添えるとフォーカスが落ち、終わったことが伝わらない → いつも置いた `sr-only` の `role="status"` と、起きた日の `h1` へのフォーカス | motion |
| 14 | 写真を選んでから届くまで何も出ず、押し直すと取り違える → 「写真を開いています」、開いている間は押せず、S1 は保存もできない | today |
| 15 | S1 で保存している間も写真を替え・外せた → 保存の間は押せない | today |
| 17, 18, 19 | 文書の古い記述（S5 の上下、S3 の「‹ つながり」、0 節の古い値） | この ADR と同時に wireframes と ADR-0009 を直した |

## 時間が無いときに削る順

上から順に外す。どれも外しても画面は成り立つ（触覚、`.press`、鍵盤の扱い、アイコンは残す）。

1. **時間帯の紙**（いまは `applyTimeOfDay` を呼んでいないので効いていない。呼ばなければそのまま。`styles/season.css` の `html[data-time=…]` の 2 規則を外してもよい）
2. **札を待つ間の糸と「思い出しています」**（`TodayScreen.vue` の `<WaitingThread>` の 1 行を外す。2.6 の静かな待ち方に戻る）
3. **S3 を左端からなぞって戻る**（`MemoryDetailScreen.vue` の `useEdgeSwipe(...)` の 1 行を外す。戻るボタンと下部ナビは残る）
4. **画面の移り変わり**（`App.vue` の `animated` を常に false にする。動きを減らす設定と同じ、待たない入れ替えになる）
5. **あの日のひとこと・このごろ**（`TodayScreen.vue` の `<ThatDayLetter>` と `<DayLeaves>` の 2 行を外す。`GET /api/today` は残してよい）

S5 の分は ADR-0009 の「時間が無いときに削る順」、見た目の分は ADR-0010 の同じ節。

## まだのこと

- **時間帯の紙が効いていない**: `web/src/main.ts` が `applyTimeOfDay()` を呼んでいない（season の受け持ちから platform への頼みごとのまま）。
  直すなら `main.ts` の `createApp(App).mount("#app")` の前に `applyTimeOfDay();` の 1 行（`import { applyTimeOfDay } from "./season"`）
- 弾む動き（ゴムの伸び）は出ない（5 節）。スクロールで鍵盤を閉じる動きも無い（4 節）
- Android の調整はしない（アイコン、鍵盤の付属バー、戻るボタンでシートだけ閉じる、はどれも未対応）
- 前に起きた「WebView が白いままになる」件は、4 回入れ直して一度も起きなかった（原因は分かっていない）
- 3 節の触覚は Simulator では鳴らない（Taptic Engine が無い）。どれも実機でしか確かめられない

## 実機で見ること（Simulator と headless Chrome でしか見ていない）

- 触覚 6 つの強さと時機（とくに `arrive` が封蝋の沈みと合うか、`stamp` が強すぎないか）
- 指で S3 を左端からなぞって戻る（縦のスクロールと取り合わないか、払いの閾値）、シートを下へなぞって閉じる、シートの間に後ろがスクロールしないこと
- 画面の移り変わりの滑らかさ（60fps か、離れていく画面が 1 フレーム透けないか）、`.press` の `:active` が指で効くか
- 実機の鍵盤（高さは端末と鍵盤の種類で変わる。外付けの鍵盤、ほかの会社の鍵盤）で、下部ナビが消えて戻ること、「保存する」が鍵盤の上に出ること、「完了」で閉じること
- 長押し: 札で下見が出ないこと、S3 の本文が選べてコピーできること
- アイコンのホーム画面での見え方（明るい表示・暗い表示・色付きの表示）
- 時間帯の紙（`applyTimeOfDay` を呼んだあと）: 夕方と夜に地と下部ナビ・シートの継ぎ目が出ないこと、起動の絵から地へ溶けること

## 影響

- 設定とネイティブ: `capacitor.config.ts`、`ios/App/App/Info.plist`、`ios/App/App/Assets.xcassets/AppIcon.appiconset/`、`web/index.html`
- 共通: `web/src/haptics.ts`、`web/src/keyboard.ts`、`web/src/motion.ts`、`web/src/season.ts`、`web/src/native.ts`、`web/src/App.vue`、`web/src/composables/useScreen.ts`・`useEdgeSwipe.ts`・`useSheetDrag.ts`、
  `web/src/style.css`、`web/src/styles/platform.css`・`today.css`・`season.css`・`connections.css`
- 画面と部品: `TodayScreen.vue`、`components/today/`（`prompts.ts`、`DayLeaves.vue`、`ThatDayLetter.vue`、`WaitingThread.vue`、`SavedCheck.vue`）、`TimelineScreen.vue`、`MemoryDetailScreen.vue`、
  `ConnectionsScreen.vue`、`WelcomeScreen.vue`、`BottomNav.vue`、`DateSheet.vue`、`FactChips.vue`、`MemoryCard.vue`、`PhotoImg.vue`、`PhotoPicker.vue`、`RecallCard.vue`、`RecalledByCard.vue`、
  `components/connections/`、`components/motifs/Leaf.vue`・`Seal.vue`、`connections/excerpt.ts`・`loom.ts`（`pickArc`）
- Worker: `worker/src/routes/today.ts`（新）、`worker/src/db/memories.ts`、`worker/src/index.ts`（2 行）。マイグレーションは要らない
- 文書: `docs/wireframes.md`（0〜4 節、6 節、7 節、第8節 #29、第9節）、`docs/architecture.md`（2 章、5.15、7.1、7.2）、`docs/setup-capacitor.md`（4 節、7 節）、ADR-0008・0009・0010 の追記
- テスト: `web/test/` の `platform`・`native`・`motion.dom`・`gestures`・`useScreenMotion`・`TodayScreen.dom`・`todayPrompts`・`FactChipsStamp.dom`・`PhotoPicker.dom`・`PhotoImg.dom`・
  `RecallCard.dom`・`season`・`seasonMotifs.dom`（新）と、`ConnectionsScreen.dom`・`MemoryDetailScreen.dom`・`excerpt`・`loom`・`useScreenFocus` の追従。`worker/test/today.test.ts`（新）
