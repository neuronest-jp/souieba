// iPhone の鍵盤（ソフトウェアキーボード）の出入り（ブラッシュアップ 11/7、ADR-0011）。
// 約束（ほかの受け持ちはこれだけを当てにする）:
//   - 鍵盤が出ている間、<html> に data-keyboard="open" を付け、閉じたら外す
//   - 鍵盤の高さ（px）を <html> の CSS 変数 --keyboard-height に入れる（閉じたら 0px）
//   - 画面の部品は useKeyboard() の open / height（読み取り専用）で知る
// 中身（@capacitor/keyboard のイベントの受け方、resize の方式、付属バー）は platform の受け持ちが決めて書く。
// Web（ブラウザでの開発）では鍵盤のイベントが無いので、いつも閉じている扱い。
import { readonly, ref } from "vue";

const open = ref(false);
const height = ref(0);

/** platform の受け持ちが、鍵盤のイベントからこれを呼ぶ */
export const setKeyboard = (isOpen: boolean, px: number): void => {
  open.value = isOpen;
  height.value = isOpen ? Math.max(0, Math.round(px)) : 0;
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (isOpen) root.setAttribute("data-keyboard", "open");
  else root.removeAttribute("data-keyboard");
  root.style.setProperty("--keyboard-height", `${height.value}px`);
};

export const useKeyboard = () => ({ open: readonly(open), height: readonly(height) });
