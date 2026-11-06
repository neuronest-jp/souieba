// 起動画像の「そういえば。」の、1 字ずつの位置（画像の px。scratchpad の slice.py で測った値）。
// 起動画像（ios/App/App/Assets.xcassets/Splash.imageset）の中央に、この 800 × 230 の帯が置かれている。
// 起動画像を作り直したら、web/src/assets/splash/ の 6 枚とこの値も作り直す（docs/setup-capacitor.md 4 節）。
export const SPLASH_MARK = {
  width: 800,
  height: 230,
  glyphs: [
    { x: 62, w: 92 }, // そ
    { x: 190, w: 68 }, // う
    { x: 286, w: 108 }, // い
    { x: 406, w: 100 }, // え
    { x: 525, w: 109 }, // ば
    { x: 630, w: 52 }, // 。
  ],
  // 句点の中心と半径（波紋の中心）
  dot: { cx: 656, cy: 146.5, r: 17.5 },
} as const;
