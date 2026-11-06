# ADR-0008: 見た目を iOS 26 / 27 の標準に寄せる

- 日付: 2026-11-07
- 状態: 採用（第 1 段。S3 と候補の行、ダークモードは続き）
- 関連: ADR-0004（デザイン基盤）を値の面で置き換える。トークンの名前と使い方の決まりは残す

## 背景

開発者が iPhone 16 Pro の実機で見て「デザインを可能な限り iOS 27 の標準のものに近づけて」と判断した（11/7）。
それまでの見た目（生成りの地 `#FAF5EC`、Zen Maru Gothic と Noto Sans JP を Google Fonts から読む、影と縁のあるカード、文字だけの帯の下部ナビ）は、
アプリとしては独自の手ざわりがあったが、iPhone の他のアプリと並べると浮いていた。

iOS 27 は iOS 26 の Liquid Glass をそのまま引き継ぎ、調整にとどまる（タブバーに検索を戻す、ガラスの不透明度を利用者が変えられる、読みやすさの調整）。
そのため、寄せる先は iOS 26 / 27 の共通の作り（浮かぶガラスのタブバー、大見出し、インセットグループの一覧、カプセルのボタン、浮いたシート）にした。

## 決めたこと

1. **色**: トークンの名前（paper / card / ink / ink-soft / ink-faint / line / ember / ember-soft / moss / moss-soft）はそのまま、値を iOS のシステムの色にする。
   - paper `#F2F2F7`（systemGroupedBackground）、card `#FFFFFF`（secondarySystemGroupedBackground）、ink `#000000`（label）
   - ink-soft `#6C6C70`。iOS の secondaryLabel（約 `#8A8A8E`）は白の上で約 3.4:1 で、wireframes 6 節の 4.5:1 に届かない。「コントラストを上げる」のときの濃さに寄せて、白で 5.2:1、`#F2F2F7` で 4.7:1
   - ink-faint `#C4C4C7`（tertiaryLabel。プレースホルダと › のような飾りだけ）、line `#C6C6C8`（opaqueSeparator）、新設の fill `#E3E3E8`（tertiarySystemFill を白に重ねた色。灰色のボタンや入力欄の地）
   - ember（アプリのアクセント色 = iOS の tint）`#A9502F`。テラコッタを深くして、白で 5.4:1、`#F2F2F7` で 4.9:1。iOS のアプリは自分の tint を持つ（メモの黄、ミュージックの赤）ので、テラコッタは tint として残す。4.5:1 を超えたので、iOS と同じく文字のボタン（「もうひとつ書く」「ひらく ›」など）を tint の文字にできる
   - danger `#D70015`（systemRed の濃い側。「はずす」「消す」）、moss `#248A3D`（確定の ✓）
2. **字体**: `-apple-system, BlinkMacSystemFont, "Hiragino Sans", system-ui`。iOS ではヒラギノ角ゴと SF、Android ではその端末の標準。Google Fonts の読み込みはやめた（`index.html`）。iOS の標準に合うことに加え、通信が遅いと読み込みを待つ間に画面が白いままになる、外部へ要求を出す、の 2 つもなくなる
3. **大きさ**: iOS の Dynamic Type の既定（Large）に合わせる。大見出し 34px 太字（S1 の日付、S2 の「これまで」、S0 のアプリ名）、本文 17px、補足 15px（`text-sm`）、注 13px（`text-xs`）。本文の行間は 1.7（日本語の長い本文なので iOS の既定の約 1.3 より広く）
4. **部品**:
   - 下部ナビ: iOS 26 / 27 のタブバー。画面の左右 21px 内側に浮いたガラスのカプセル（半透明 + ぼかし + 細い縁 + 影。`.glass`）。高さ 62px。絵 26px の下に 11px の文字。選択中は tint の塗りの絵と文字にし、後ろに淡い選択の地を敷く。非選択は ink の線の絵
   - 一覧（S2）: インセットグループ。白い角丸 26px の欄に行を並べ、区切り線は 0.5px で文字の始まりから、右に ›。写真の無い行の左の空き（56px）はなくした
   - ボタン: 主ボタンは tint の塗りのカプセル、高さ 50px、17px 半太字、幅いっぱい。副ボタンは fill の地に tint の文字。押したら少し縮む
   - カード: 影も縁も無い白い角丸 26px。札の左の 3px の縁はやめ、「そういえば。」を tint の 22px にした
   - シート: 画面の端から 8px 浮いた角丸 34px、上に掴み手。「いつ？」の精度は iOS のセグメント
   - 起動画面: paper の一色（iOS / Android とも）
5. **絵**: SF Symbols は使わない（Apple の利用条件は Apple のプラットフォームのアプリに限られ、Android 版にも同じ画面を出すため）。下部ナビの絵は自前の SVG のまま、選択中は塗りの形にする（SF Symbols の `.fill` と同じ考え）

## wireframes との違い（この ADR を優先する）

- 0 節の色の値、字体、カードの影と縁、主ボタンの高さ 48px と 19px、テキストボタンの 1px の ember の下線、下部ナビの作りは本 ADR の値に置き換わる
- 6 節「14px を下回らない」に対し、下部ナビの文字 11px と、セグメントの文字 13px は iOS の標準に合わせて下回る。どちらも絵や並びで意味が分かり、`aria-current` / `aria-pressed` で読み上げにも状態が伝わる
- N-3 / ADR-0004 の本文の行間 1.8 は 1.7 にした

## まだのこと

- S3（記憶の詳細）と候補の行（FactChips）、S3 の札（RecalledByCard）、削除の確認のシート: 同じ時間に別の修正が入っているため、それが入ってから寄せる
- ダークモード: iOS の標準は端末の設定に追従する。トークンは色の値だけなので `prefers-color-scheme: dark` で切り替えられるが、ステータスバーの文字色（`native.ts` の `Style.Light`）、起動画面、WebView の地の色も合わせて変える必要がある。今は `color-scheme: light` で明るい側に固定している
- Liquid Glass の光の屈折は CSS では再現できない。半透明 + ぼかし + 細い縁 + 影で近づけている
