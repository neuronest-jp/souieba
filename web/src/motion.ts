// 動きの共通の道具（motion の受け持ち。ブラッシュアップ 11/7、ADR-0011）。
// 速さは style.css の @theme のトークンと同じ数（--duration-quick / base / slow）。JS で待つ時間はここから取り、CSS と食い違わせない。
import { arrive } from "./haptics";

export const DURATION = { quick: 160, base: 280, slow: 460 } as const;

/** 動きを付けてよいか。prefers-reduced-motion: reduce のときと、matchMedia の無い環境（テスト）では false（待たずに状態だけ切り替える） */
export const prefersMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 「そういえば。」の札が届いたときの触覚。封蝋が押される瞬間（style.css の .note.appear .seal: 360ms 待って 400ms で押す。
// いちばん沈むのは半ば）に合わせる。同時に何枚届いても 1 度だけ鳴らす。届く前に札が全部外れたら鳴らさない
export const SEAL_IMPACT_MS = 560;
let arriveTimer: ReturnType<typeof setTimeout> | null = null;
const waiting = new Set<symbol>();

export const arriveSoon = (owner: symbol): void => {
  waiting.add(owner);
  if (arriveTimer) return;
  arriveTimer = setTimeout(
    () => {
      arriveTimer = null;
      const any = waiting.size > 0;
      waiting.clear();
      if (any) arrive();
    },
    prefersMotion() ? SEAL_IMPACT_MS : 0,
  );
};

export const cancelArrive = (owner: symbol): void => {
  waiting.delete(owner);
  if (waiting.size === 0 && arriveTimer) {
    clearTimeout(arriveTimer);
    arriveTimer = null;
  }
};

// 画面の移り変わりで離れていく画面（App.vue の <Transition> の before-leave / after-leave）。
// 見ていた位置のまま position: fixed で留めて流れから外す（入ってくる画面が位置を戻しても動かない）。hashchange の時点で
// 位置はもう 0 に送られているので、離れる前の位置（scrollY）から見えていた所を出す。offset* は transform を数えない
// （なぞって戻るときの S3 は指の位置にずれたまま）。読み上げと指からは外し（inert、aria-hidden）、data-leaving で
// 見出しの探し先（focusScreenHeading）から外す
const PINNED = ["position", "top", "left", "width", "height", "margin"] as const;
export const pinLeaving = (el: HTMLElement, scrollY: number): void => {
  const box = { top: el.offsetTop - scrollY, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight };
  el.setAttribute("data-leaving", "");
  el.setAttribute("aria-hidden", "true");
  el.inert = true;
  el.style.position = "fixed";
  el.style.top = `${box.top}px`;
  el.style.left = `${box.left}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
  el.style.margin = "0";
};
/** KeepAlive で残す画面は仕舞われたあとまた出てくるので、付けたものを全部外す（なぞりの印も） */
export const unpinLeaving = (el: HTMLElement): void => {
  if (!el.hasAttribute("data-leaving")) return;
  el.removeAttribute("data-leaving");
  el.removeAttribute("aria-hidden");
  el.inert = false;
  for (const k of PINNED) el.style[k] = "";
  el.style.transform = "";
  el.style.transition = "";
  el.style.opacity = "";
  el.removeAttribute("data-dragging");
};
