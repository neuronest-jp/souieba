// 下からのシートの手ざわり（ブラッシュアップ 11/7、motion の受け持ち。DateSheet と S3 の「消しますか」で使い、PairSheet でも使える）。
//   - 開くとき: 紙がばねで上がる（.sheet-paper の sheet-up。地は .sheet-backdrop がふわっと暗くなる）
//   - 閉じるとき（close）: 紙が下へすっと下がり、地が明るく戻ってから onClose を呼ぶ（動きを減らす設定では待たずに呼ぶ）
//   - 掴み手かシートを下へなぞると、指に付いて下がる。離した位置と速さで閉じるか戻るかを決める（sheetDecision）。
//     速さは離したときのもの（払ってから指を止めて離したら払ったとみなさない）
//   - 動きを減らす設定では紙も地も指に付いてこず、下へ reduceCommit px なぞった時点で待たずに閉じる（useEdgeSwipe と同じ形。ADR-0011 の 6 節）
//   - 開いている間は後ろの画面をスクロールさせない（シートの外の touchmove / wheel を止める。シートの中のスクロールする所は止めない）
// 使い方（テンプレートの ref の名前は返した変数の名前と同じにする）:
//   const { panel, backdrop, close } = useSheetDrag({ onClose: () => emit("close") });
//   <div class="sheet-host fixed inset-0 z-20 flex items-end justify-center">  ← 置き場（色を持たない。touch-action: none）
//     <div ref="backdrop" class="sheet-backdrop absolute inset-0 bg-ink/30" aria-hidden="true" @click="close"></div>
//     <div ref="panel" class="sheet-paper relative ..." role="dialog" aria-modal="true"> … <div class="sheet-grip …"></div> …
//   Esc・「とじる」も close を呼ぶ。中身がスクロールするシートは、スクロールする要素に data-sheet-scroll を付ける
//   （その要素がいちばん上にあるときだけ、下へなぞるとシートが下がる）
import { getCurrentInstance, onUnmounted, ref, watch, type Ref } from "vue";
import { DURATION, prefersMotion } from "../motion";

/** なぞりの閾値。slop: これだけ動くまでは押しただけとみなす（中のボタンは押せる）。
 *  離したとき、下へ速く払った（flick px/ms 以上で flickMin px 以上動いた）か、シートの高さの closeRatio（ただし closeDistance px まで）
 *  より下へ下げていたら閉じる。上へ速く払ったら戻す。
 *  reduceCommit: 動きを減らす設定で、触れた所からこれより下へなぞった時点で閉じる距離 */
export const SHEET = { slop: 8, closeRatio: 0.3, closeDistance: 140, flick: 0.5, flickMin: 16, reduceCommit: 40 } as const;

export const sheetDecision = ({ dy, vy, height }: { dy: number; vy: number; height: number }): "close" | "stay" => {
  if (vy < -SHEET.flick) return "stay";
  if (vy > SHEET.flick && dy > SHEET.flickMin) return "close";
  return dy > Math.min(height * SHEET.closeRatio, SHEET.closeDistance) ? "close" : "stay";
};

/** 速さを測る終わりの幅（ms） */
const VELOCITY_WINDOW = 80;

/** 指の位置の記録から、終わりの 80ms の速さ（px/ms）を出す。記録が 1 つなら 0。
 *  releasedAt（離したときの timeStamp）が最後の記録より 80ms より後なら、指は止まっていたので 0
 *  （iPhone の WebKit は指が止まっている間 touchmove を出さないので、最後の記録は止める前の動きのまま残る）。
 *  離した時刻の分からないとき（timeStamp の無いイベント）は、最後の記録までの速さを使う */
export const velocityOf = (samples: ReadonlyArray<{ t: number; v: number }>, releasedAt?: number): number => {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  if (typeof releasedAt === "number" && releasedAt - last.t > VELOCITY_WINDOW) return 0;
  const first = samples.find((s) => last.t - s.t <= VELOCITY_WINDOW) ?? last;
  const dt = last.t - first.t;
  return dt > 0 ? (last.v - first.v) / dt : 0;
};

const scrollerOf = (target: EventTarget | null, panel: HTMLElement): HTMLElement | null => {
  for (let n = target as HTMLElement | null; n && n !== panel.parentElement; n = n.parentElement) {
    if (n.hasAttribute?.("data-sheet-scroll")) return n;
  }
  return null;
};
const canScroll = (el: HTMLElement | null) => !!el && el.scrollHeight > el.clientHeight + 1;

export function useSheetDrag(opts: { onClose: () => void; canDrag?: () => boolean }) {
  const panel = ref<HTMLElement | null>(null);
  const backdrop = ref<HTMLElement | null>(null);
  const closing = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  let start: { x: number; y: number } | null = null;
  let mode: "idle" | "pending" | "drag" | "free" = "idle";
  let samples: Array<{ t: number; v: number }> = [];
  let scroller: HTMLElement | null = null;

  const setOffset = (el: HTMLElement, y: number) => {
    el.style.transform = y === 0 ? "" : `translate3d(0, ${y}px, 0)`;
    const b = backdrop.value;
    if (b) b.style.opacity = y > 0 ? String(Math.max(0.15, 1 - y / Math.max(1, el.offsetHeight))) : "";
  };
  /** 紙と地に付けた inline の位置・濃さ・動きを、動かさずに外す */
  const resetInline = (el: HTMLElement) => {
    el.style.transition = "";
    el.style.transform = "";
    const b = backdrop.value;
    if (b) {
      b.style.transition = "";
      b.style.opacity = "";
    }
  };
  const animateTo = (el: HTMLElement, transform: string, opacity: string, ms: number, ease: string) => {
    el.style.transition = `transform ${ms}ms ${ease}`;
    el.style.transform = transform;
    const b = backdrop.value;
    if (b) {
      b.style.transition = `opacity ${ms}ms var(--ease-out-soft)`;
      b.style.opacity = opacity;
    }
  };

  /** 紙を下げてから onClose を呼ぶ（何度呼んでも 1 回だけ） */
  const close = () => {
    if (closing.value) return;
    closing.value = true;
    const el = panel.value;
    if (!el || !prefersMotion()) {
      opts.onClose();
      return;
    }
    el.style.animation = "none"; // 上がる途中に閉じても、いまの位置から下げる
    animateTo(el, "translate3d(0, calc(100% + 24px), 0)", "0", DURATION.base, "var(--ease-out-soft)");
    timer = setTimeout(() => {
      timer = null;
      opts.onClose();
    }, DURATION.base);
  };

  const onStart = (e: TouchEvent) => {
    const t = e.touches[0];
    if (closing.value || e.touches.length !== 1 || !t || !panel.value) return;
    start = { x: t.clientX, y: t.clientY };
    mode = "pending";
    samples = [{ t: e.timeStamp, v: t.clientY }];
    scroller = scrollerOf(e.target, panel.value);
  };
  const onMove = (e: TouchEvent) => {
    const el = panel.value;
    const t = e.touches[0];
    if (!el || !t || !start || mode === "idle") return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (mode === "pending") {
      if (Math.abs(dx) < SHEET.slop && Math.abs(dy) < SHEET.slop) return;
      const down = dy > 0 && Math.abs(dy) > Math.abs(dx);
      const atTop = !canScroll(scroller) || (scroller?.scrollTop ?? 0) <= 0;
      if (down && atTop && (opts.canDrag?.() ?? true)) {
        mode = "drag";
        // 指に付けて動かすので、上がる途中の動きと戻りの動きを止める（動きを減らす設定では紙を動かさないので触れない）
        if (prefersMotion()) {
          el.style.animation = "none";
          el.style.transition = "none";
          if (backdrop.value) backdrop.value.style.transition = "none";
        }
      } else {
        mode = "free"; // 横や上へ動いた、または中のスクロール（そのまま任せる）
        return;
      }
    }
    if (mode !== "drag") return;
    if (e.cancelable) e.preventDefault();
    if (!prefersMotion()) {
      // 動きを減らす設定: 紙は指に付いてこない。下へ一定の距離を越えた時点で閉じる（close はこの設定では待たずに onClose を呼ぶ）
      if (dy > SHEET.reduceCommit) {
        mode = "idle";
        start = null;
        close();
      }
      return;
    }
    samples.push({ t: e.timeStamp, v: t.clientY });
    if (samples.length > 8) samples.shift();
    const d = dy - SHEET.slop;
    setOffset(el, d >= 0 ? d : Math.max(-12, d / 5)); // 上へは紙が少したわむだけ
  };
  // e は touchend / touchcancel。timeStamp で離したときの速さを出す（無ければ最後の touchmove までの速さ）
  const onEnd = (e?: TouchEvent) => {
    const el = panel.value;
    const was = mode;
    const from = start;
    mode = "idle";
    start = null;
    // なぞっている間に閉じた（Esc や地を押したのと重なった）ときは、閉じる動きをそのまま続ける
    if (was !== "drag" || !el || !from || closing.value) return;
    // 動きを減らす設定: 閉じるのは onMove で距離を越えたときだけ。ここでは何も動かさず、残った inline の印を外すだけ
    if (!prefersMotion()) {
      resetInline(el);
      return;
    }
    const dy = (samples[samples.length - 1]?.v ?? from.y) - from.y - SHEET.slop;
    if (sheetDecision({ dy, vy: velocityOf(samples, e?.timeStamp), height: el.offsetHeight }) === "close") close();
    else animateTo(el, "", "", DURATION.base, "var(--ease-spring)");
  };
  // シートの外（地）で指を動かしても、後ろの画面をスクロールさせない。シートの中は、スクロールする所だけ任せる
  const lockMove = (e: TouchEvent) => {
    const el = panel.value;
    if (mode === "drag" || !el) return;
    const inPanel = el.contains(e.target as Node);
    if (inPanel && canScroll(scrollerOf(e.target, el))) return;
    if (e.cancelable) e.preventDefault();
  };
  const lockWheel = (e: WheelEvent) => {
    const el = panel.value;
    if (el && el.contains(e.target as Node) && canScroll(scrollerOf(e.target, el))) return;
    e.preventDefault();
  };

  const attach = (el: HTMLElement) => {
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
  };
  const detach = (el: HTMLElement) => {
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchmove", onMove);
    el.removeEventListener("touchend", onEnd);
    el.removeEventListener("touchcancel", onEnd);
  };
  // 置き場（パネルの親）に付けて、地とパネルの両方の動きを止める
  const attachLock = (host: HTMLElement) => {
    host.addEventListener("touchmove", lockMove, { passive: false });
    host.addEventListener("wheel", lockWheel, { passive: false });
  };
  const detachLock = (host: HTMLElement) => {
    host.removeEventListener("touchmove", lockMove);
    host.removeEventListener("wheel", lockWheel);
  };

  let host: HTMLElement | null = null;
  watch(
    panel,
    (el, old) => {
      if (old) detach(old);
      if (host) detachLock(host);
      host = null;
      if (!el) return;
      // 開き直したシートは閉じかけの印を持ち越さない
      closing.value = false;
      mode = "idle";
      attach(el);
      host = el.parentElement;
      if (host) attachLock(host);
    },
    { flush: "post" },
  );
  if (getCurrentInstance()) {
    onUnmounted(() => {
      if (timer) clearTimeout(timer);
      if (panel.value) detach(panel.value);
      if (host) detachLock(host);
    });
  }

  return { panel, backdrop, close, closing: closing as Readonly<Ref<boolean>> };
}
