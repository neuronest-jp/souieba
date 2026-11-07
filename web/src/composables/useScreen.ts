// location.hash を画面に写す。#today（既定）/ #past / #connections / #memory/<id>[?from=today|connections][&recall=<recall_id>]。
// 戻るボタンは hashchange で追従する。recall は S1 の札やつながりの組から開いたときの札の id（wireframes 4.2、5 節）。
// from は S3 の戻り先と下部ナビの現在地（既定は past）。
import { nextTick, onMounted, onUnmounted, ref } from "vue";

// S3 を開いた元の画面（戻る先）。S1 / S2 / S5
export type From = "today" | "past" | "connections";

export type Screen =
  | { name: "today" }
  | { name: "past" }
  | { name: "connections" }
  | { name: "memory"; id: string; from: From; recall?: string };

const isFrom = (v: string): v is From => v === "today" || v === "past" || v === "connections";

export const parseHash = (hash: string): Screen => {
  const h = hash.replace(/^#/, "");
  if (h === "past") return { name: "past" };
  if (h === "connections") return { name: "connections" };
  const q = h.indexOf("?");
  const m = /^memory\/([^/?]+)$/.exec(q < 0 ? h : h.slice(0, q));
  if (m && m[1]) {
    let id: string;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      return { name: "today" }; // 壊れた %xx（手で打った URL など）で画面ごと落とさない
    }
    const params = new URLSearchParams(q < 0 ? "" : h.slice(q + 1));
    const from = params.get("from") ?? "past";
    if (!isFrom(from)) return { name: "today" };
    const recall = params.get("recall");
    return { name: "memory", id, from, ...(recall ? { recall } : {}) };
  }
  return { name: "today" };
};

export const hrefFor = (s: Screen): string => {
  if (s.name === "past") return "#past";
  if (s.name === "connections") return "#connections";
  if (s.name === "memory") {
    // from=past で recall も無ければクエリを付けない（今までと同じ文字列）
    const params = new URLSearchParams();
    if (s.from !== "past") params.set("from", s.from);
    if (s.recall) params.set("recall", s.recall);
    const query = params.toString();
    return `#memory/${encodeURIComponent(s.id)}${query ? `?${query}` : ""}`;
  }
  return "#today";
};

export const go = (s: Screen) => {
  window.location.hash = hrefFor(s);
};

// アプリ内で積んだ履歴の数。外のページから #memory/<id> を直接開いた場合は 0 なので、戻るでアプリの外に出ない。
let depth = 0;
export const canGoBack = () => depth > 0;
export const back = (fallback: Screen) => {
  if (canGoBack()) {
    depth -= 2; // hashchange で +1 されるぶんを先に引く
    window.history.back();
  } else {
    go(fallback);
  }
};

// 見出し（h1）にフォーカスを置く。押したリンクやボタンが画面ごと消えるとフォーカスは body に落ち、読み上げソフトでは
// 新しい画面が何も読まれないため（wireframes 6 節）。tabindex="-1" は置くあいだだけ付け、離れたら外す（FactChips と同じ）。
// 最初から付けておくと、指で見出しに触れただけでそこへフォーカスが移り、S1 では書いている途中の入力欄からキーボードが閉じる。
// force でなければ、フォーカスが落ちているときだけ動かす（読み込みを待つ間に利用者が動かしたフォーカスは奪わない）。
// 外れた要素（KeepAlive で離れている画面の見出しなど）には置かない
export const focusHeading = (el: HTMLElement | null | undefined, { force = false } = {}) => {
  if (!el || !el.isConnected) return;
  const active = document.activeElement;
  if (!force && active && active !== document.body) return;
  el.setAttribute("tabindex", "-1");
  el.addEventListener("blur", () => el.removeAttribute("tabindex"), { once: true });
  el.focus({ preventScroll: true }); // 位置は onChange が戻す。フォーカスで動かさない
};

// いま出ている画面の h1。S3 は読み込みが終わるまで h1 が無いので、そのときは何もしない（MemoryDetailScreen が置く）
export const focusScreenHeading = (opts: { force?: boolean } = {}) =>
  focusHeading(document.querySelector<HTMLElement>("main h1"), opts);

// S1 / S2 / S5 は App.vue の KeepAlive で残すので、離れたときの位置を覚えて、戻ったときにそこへ戻す。S3 は毎回いちばん上。
const keptKey = (s: Screen): string | null => (s.name === "memory" ? null : s.name);

export function useScreen() {
  const screen = ref<Screen>(parseHash(window.location.hash));
  const positions = new Map<string, number>();
  const onChange = () => {
    depth += 1;
    const leaving = keptKey(screen.value);
    if (leaving) positions.set(leaving, window.scrollY);
    screen.value = parseHash(window.location.hash);
    const arriving = keptKey(screen.value);
    const top = arriving ? (positions.get(arriving) ?? 0) : 0;
    window.scrollTo({ top: 0 });
    // 残した画面の DOM が戻るのは次の描画。そのあとで位置を戻す
    if (top > 0) void nextTick(() => window.scrollTo({ top }));
    // 新しい画面の h1 へフォーカスを移し、読み上げで画面が変わったことを伝える。下部ナビのリンクは消えずに
    // フォーカスを持ったまま残るので、ここでは force で動かす（利用者が画面を移した直後なので奪うものは無い）
    void nextTick(() => focusScreenHeading({ force: true }));
  };
  onMounted(() => {
    // 位置は自分で戻す。ブラウザに任せると、戻る操作では hashchange より先に位置が変わり、離れる画面の位置を取り違える
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    window.addEventListener("hashchange", onChange);
  });
  onUnmounted(() => window.removeEventListener("hashchange", onChange));
  return { screen };
}
