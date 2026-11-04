// location.hash を画面に写す。#today（既定）/ #past / #memory/<id>。戻るボタンは hashchange で追従する。
import { onMounted, onUnmounted, ref } from "vue";

export type Screen = { name: "today" } | { name: "past" } | { name: "memory"; id: string; from: "today" | "past" };

const parse = (hash: string): Screen => {
  const h = hash.replace(/^#/, "");
  if (h === "past") return { name: "past" };
  const m = /^memory\/([^/?]+)(?:\?from=(today|past))?$/.exec(h);
  if (m && m[1]) return { name: "memory", id: decodeURIComponent(m[1]), from: m[2] === "today" ? "today" : "past" };
  return { name: "today" };
};

export const hrefFor = (s: Screen): string => {
  if (s.name === "past") return "#past";
  if (s.name === "memory") return `#memory/${encodeURIComponent(s.id)}${s.from === "today" ? "?from=today" : ""}`;
  return "#today";
};

export const go = (s: Screen) => {
  window.location.hash = hrefFor(s);
};

export function useScreen() {
  const screen = ref<Screen>(parse(window.location.hash));
  const onChange = () => {
    screen.value = parse(window.location.hash);
    window.scrollTo({ top: 0 });
  };
  onMounted(() => window.addEventListener("hashchange", onChange));
  onUnmounted(() => window.removeEventListener("hashchange", onChange));
  return { screen };
}
