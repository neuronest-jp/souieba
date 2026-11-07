// 触覚（iPhone の Taptic Engine。ADR-0011）。手ざわりの言葉に合わせて名前を付け、画面からはこの関数だけを呼ぶ。
// Web（ブラウザでの開発）では何もしない。プラグインの失敗は無視する（触覚が無くても操作は成り立つ）。
// 呼ぶ所は「利用者が押した直後」だけにする。読み込みや取り直しのような、利用者の手を離れた出来事では鳴らさない
// （例外は、待っていた「そういえば。」の札が届いたとき = arrive）。
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isNative } from "./native";

const run = (fn: () => Promise<void>): void => {
  if (!isNative()) return;
  fn().catch(() => {
    /* 触覚が使えない端末・設定 */
  });
};

/** ふつうのボタンを押したとき（ごく軽く） */
export const tap = (): void => run(() => Haptics.impact({ style: ImpactStyle.Light }));

/** 選ぶものを切り替えたとき（下部ナビ、日付の精度など） */
// @capacitor/haptics 8.0.2 の iOS は、selectionStart で作る UISelectionFeedbackGenerator が無いと
// selectionChanged が何もしない（Haptics.swift。Promise は成功で終わるので、黙って鳴らない）。Android も
// selectionStarted の旗で同じ形。そこで呼ぶたびに selectionStart → selectionChanged の順に呼ぶ:
// - selectionStart は呼ぶたびに generator を作り直すだけなので軽い。起動時に一度だけ作って持ち続ける形
//   （setupNative で呼ぶ）は、main.ts が待たずに走らせるので最初の 1 回に間に合う保証が無く、
//   間に合わなければ同じく黙って鳴らない。プラグインの中の generator が残り続けることにも頼らずに済む
// - どちらのメソッドも、直列の bridge の queue から main queue へ積む順で動く。await で並べれば、
//   generator ができてから selectionChanged が動く。selectionStart が失敗したら selectionChanged は呼ばない
// - selectionEnd は呼ばない（次の selectionStart が generator を置き換える）
export const select = (): void =>
  run(async () => {
    await Haptics.selectionStart();
    await Haptics.selectionChanged();
  });

/** 判を押したとき（候補を「そう」と確かめた、札に「そうだった」と返した） */
export const stamp = (): void => run(() => Haptics.impact({ style: ImpactStyle.Medium }));

/** 便箋を残したとき（保存できた） */
export const saved = (): void => run(() => Haptics.notification({ type: NotificationType.Success }));

/** 「そういえば。」の札が届いたとき（封蝋が押される動きに合わせる） */
export const arrive = (): void => run(() => Haptics.impact({ style: ImpactStyle.Light }));

/** 記録や保存に失敗したとき */
export const failed = (): void => run(() => Haptics.notification({ type: NotificationType.Warning }));
