// location.hash を画面に写す。#today（既定）/ #past / #memory/<id>[?from=today][&recall=<recall_id>]。
// 戻るボタンは hashchange で追従する。recall は S1 の札から開いたときの札の id（wireframes 4.2）。
import { nextTick, onMounted, onUnmounted, ref } from "vue";

export type Screen =
  | { name: "today" }
  | { name: "past" }
  | { name: "memory"; id: string; from: "today" | "past"; recall?: string };

export const parseHash = (hash: string): Screen => {
  const h = hash.replace(/^#/, "");
  if (h === "past") return { name: "past" };
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
    const from = params.get("from");
    if (from !== null && from !== "today" && from !== "past") return { name: "today" };
    const recall = params.get("recall");
    return { name: "memory", id, from: from === "today" ? "today" : "past", ...(recall ? { recall } : {}) };
  }
  return { name: "today" };
};

export const hrefFor = (s: Screen): string => {
  if (s.name === "past") return "#past";
  if (s.name === "memory") {
    // from=past で recall も無ければクエリを付けない（今までと同じ文字列）
    const params = new URLSearchParams();
    if (s.from === "today") params.set("from", "today");
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

// S1 / S2 は App.vue の KeepAlive で残すので、離れたときの位置を覚えて、戻ったときにそこへ戻す。S3 は毎回いちばん上。
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
  };
  onMounted(() => {
    // 位置は自分で戻す。ブラウザに任せると、戻る操作では hashchange より先に位置が変わり、離れる画面の位置を取り違える
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    window.addEventListener("hashchange", onChange);
  });
  onUnmounted(() => window.removeEventListener("hashchange", onChange));
  return { screen };
}
