// S3 を左端からなぞって戻る（iPhone の戻る手ざわり。ブラッシュアップ 11/7、motion の受け持ち）。
//   - 画面の左端 edge px の中で触れ、横へ（右へ）動いたときだけ拾う。縦が先なら縦のスクロールに任せる（取り合わない）
//   - 拾ったら S3 の紙が指に付いて右へ動く（下には机の地が見える。前の画面は KeepAlive に仕舞われていて、ここでは描けない）
//   - 離した位置と速さ（swipeDecision）で、戻るか元に戻るかを決める。戻るときは select の触覚を鳴らし、紙は指の位置から右へ出ていく。
//     速さは離したときのもの（払ってから指を止めて離したら、迷って止めたとみなして戻らない）
//   - 動きを減らす設定では紙を動かさず、reduceCommit px 右へなぞった時点で、すぐに戻る
// 紙の地と左の影は style.css の main[data-dragging]（画面の移り変わりの紙と同じ）
// KeepAlive で残す画面（S6 ことばの地図）でも使う。仕舞われている間は document の受け手を外し、出てきたら付け直す
// （付けたままだと、ほかの画面でなぞったときにも仕舞われた画面の戻るが走る）。外れた要素・離れていく途中の要素では拾わない
import { onActivated, onDeactivated, onMounted, onUnmounted, type Ref } from "vue";
import { select } from "../haptics";
import { DURATION, prefersMotion } from "../motion";
import { velocityOf } from "./useSheetDrag";

/** edge: 拾う左端の幅。slop: 向きを決めるまでの動き。離したとき、幅の commitRatio より右なら戻る。
 *  右へ速く払った（flick px/ms 以上で flickMin px 以上動いた）ら短くても戻る。左へ速く払ったら戻らない */
export const SWIPE = { edge: 24, slop: 10, commitRatio: 0.5, flick: 0.3, flickMin: 24, reduceCommit: 32 } as const;

export const swipeDecision = ({ dx, vx, width }: { dx: number; vx: number; width: number }): "back" | "stay" => {
  if (vx < -SWIPE.flick) return "stay";
  if (vx > SWIPE.flick && dx > SWIPE.flickMin) return "back";
  return dx > width * SWIPE.commitRatio ? "back" : "stay";
};

export function useEdgeSwipe(target: Ref<HTMLElement | null>, opts: { onBack: () => void; enabled?: () => boolean }) {
  let start: { x: number; y: number } | null = null;
  let mode: "idle" | "pending" | "drag" | "done" = "idle";
  let samples: Array<{ t: number; v: number }> = [];
  let settle: ReturnType<typeof setTimeout> | null = null;

  const clear = (el: HTMLElement) => {
    el.style.transition = "";
    el.style.transform = "";
    el.removeAttribute("data-dragging");
  };

  const commit = (el: HTMLElement) => {
    mode = "done";
    select();
    if (prefersMotion()) {
      // 指の位置から右へ出ていく。App.vue は swipe のときこの inline の動きをそのまま使う（上書きしない）
      el.style.transition = `transform ${DURATION.base}ms var(--ease-out-soft)`;
      el.style.transform = "translate3d(100vw, 0, 0)";
    } else clear(el);
    opts.onBack();
    // 戻れなかった（画面が変わらなかった）ときに、右へ出たままの S3 を残さない。
    // 画面を離れていても次のなぞりは拾えるように戻す（KeepAlive で残す画面は、また出てくる）。
    // 離れていく途中（data-leaving）の印は App.vue の unpinLeaving が外す
    if (settle) clearTimeout(settle);
    settle = setTimeout(() => {
      settle = null;
      mode = "idle";
      if (!el.hasAttribute("data-leaving")) clear(el);
    }, 1000);
  };

  const cancel = (el: HTMLElement) => {
    el.style.transition = `transform ${DURATION.base}ms var(--ease-out-soft)`;
    el.style.transform = "";
    // 動き終わったら inline の印を外す（transform が残ると、中の fixed のシートが S3 に縛られる）
    if (settle) clearTimeout(settle);
    settle = setTimeout(() => {
      settle = null;
      if (mode !== "drag" && mode !== "done") clear(el);
    }, DURATION.base + 40);
  };

  const onStart = (e: TouchEvent) => {
    const t = e.touches[0];
    if (mode === "done" || e.touches.length !== 1 || !t || t.clientX > SWIPE.edge) return;
    const el = target.value;
    if (!el || !el.isConnected || el.hasAttribute("data-leaving") || !(opts.enabled?.() ?? true)) return;
    start = { x: t.clientX, y: t.clientY };
    mode = "pending";
    samples = [{ t: e.timeStamp, v: t.clientX }];
  };

  const onMove = (e: TouchEvent) => {
    const el = target.value;
    const t = e.touches[0];
    if (!el || !t || !start || (mode !== "pending" && mode !== "drag")) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (mode === "pending") {
      if (Math.abs(dx) < SWIPE.slop && Math.abs(dy) < SWIPE.slop) {
        // 向きが決まるまでも、横向きの動きは止めておく（iPhone は最初の touchmove を止めないと、あとから止められない）
        if (Math.abs(dx) >= Math.abs(dy) && e.cancelable) e.preventDefault();
        return;
      }
      if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) {
        mode = "idle"; // 縦のスクロール（か左への動き）。この指はもう拾わない
        start = null;
        return;
      }
      mode = "drag";
      if (settle) clearTimeout(settle);
      el.setAttribute("data-dragging", "");
      el.style.transition = "none";
    }
    if (e.cancelable) e.preventDefault();
    if (!prefersMotion()) {
      if (dx > SWIPE.reduceCommit) commit(el);
      return;
    }
    samples.push({ t: e.timeStamp, v: t.clientX });
    if (samples.length > 8) samples.shift();
    el.style.transform = `translate3d(${Math.max(0, dx)}px, 0, 0)`;
  };

  // e は touchend / touchcancel。timeStamp で離したときの速さを出す（無ければ最後の touchmove までの速さ）
  const onEnd = (e?: TouchEvent) => {
    const el = target.value;
    const from = start;
    const was = mode;
    if (mode !== "done") mode = "idle";
    start = null;
    if (was !== "drag" || !el || !from) return;
    const dx = (samples[samples.length - 1]?.v ?? from.x) - from.x;
    const width = typeof window !== "undefined" ? window.innerWidth : el.offsetWidth;
    if (swipeDecision({ dx, vx: velocityOf(samples, e?.timeStamp), width }) === "back") commit(el);
    else cancel(el);
  };

  // テストの最小の DOM（document に addEventListener が無い）では付けない
  const listenable = () => typeof document !== "undefined" && typeof document.addEventListener === "function";
  let attached = false;
  const attach = () => {
    if (attached || !listenable()) return;
    attached = true;
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
  };
  const detach = () => {
    if (!attached) return;
    attached = false;
    document.removeEventListener("touchstart", onStart);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("touchcancel", onEnd);
  };
  // なぞりの途中の状態を捨てる。離れていく途中の要素の inline の動き（右へ出ていく）は残す（unpinLeaving が外す）
  const reset = () => {
    if (settle) clearTimeout(settle);
    settle = null;
    start = null;
    samples = [];
    mode = "idle";
    const el = target.value;
    if (el && !el.hasAttribute("data-leaving")) clear(el);
  };
  onMounted(attach);
  // KeepAlive の中だけで呼ばれる（最初の表示のあとにも呼ばれるが、付けてあれば何もしない）
  onActivated(() => {
    reset();
    attach();
  });
  onDeactivated(() => {
    detach();
    reset();
  });
  onUnmounted(() => {
    if (settle) clearTimeout(settle);
    detach();
  });
}
