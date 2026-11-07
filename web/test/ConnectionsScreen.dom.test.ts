// S5 つながり（ADR-0009、wireframes 5 節）。空・1 組・反応（そうだった → 判と本縫い、関係ないかも → 閉じたら外れる、失敗で戻る）、
// シートのフォーカスと inert、最初の表示だけ動かすこと、下部ナビの 3 つめ。DOM は web/test/fakeDom.ts の最小のもの。
// 見た目の細部（糸の線の種類や色）はブラウザで撮って確かめる。ここでは data-stitch と判・封蝋の有無で形の区別を固定する
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, KeepAlive, nextTick, ref } from "vue";
import type { Connection, ConnectionsResponse } from "../src/api/types";
import { fakeDocument, mount, resetFakeDocument, type FakeElement } from "./fakeDom";

const { connections, recallFeedback } = vi.hoisted(() => ({
  connections: vi.fn<() => Promise<ConnectionsResponse>>(),
  recallFeedback: vi.fn<(id: string, feedback: string) => Promise<unknown>>(),
}));
vi.mock("../src/api", () => ({
  ApiError: class extends Error {},
  api: {
    connections: () => connections(),
    recallFeedback: (id: string, feedback: string) => recallFeedback(id, feedback),
  },
}));

const ConnectionsScreen = (await import("../src/screens/ConnectionsScreen.vue")).default;
const BottomNav = (await import("../src/components/BottomNav.vue")).default;

const UME = "おばあちゃんは毎年6月になると、縁側で梅干しを漬けていた。青梅を水に浸けて、ひとつずつヘタを取るのを手伝った。";
// 書いた側は 2025 年の日付にする（今年の日付は曜日付きで出て、年が変わると文字が変わるため）
const pair = (id: string, over: Partial<Connection> = {}): Connection => ({
  id,
  reason: "青梅を見て季節を感じた新しい記憶は、祖母と梅干しを漬けた思い出につながる。",
  evidence: "青梅を水に浸けて、ひとつずつヘタを取るのを手伝った。",
  feedback: "none",
  created_at: "2025-11-07T09:30:00.000Z",
  memory: { id: `${id}_new`, body: "スーパーで青梅を見かけた。もうそんな季節か", happened_on: "2025-11-07", happened_on_precision: "day", photo_key: null },
  related_memory: { id: `${id}_old`, body: UME, happened_on: "2024-06-01", happened_on_precision: "month", photo_key: null },
  ...over,
});
const beads: ConnectionsResponse["beads"] = [
  { happened_on: "2025-11-07", happened_on_precision: "day" },
  { happened_on: "2024-06-01", happened_on_precision: "month" },
];

const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const byTag = (root: FakeElement, tag: string) => root.findAll((el) => el.tagName === tag);
const button = (root: FakeElement, label: string) => root.findAll((el) => el.tagName === "BUTTON" && el.textContent.trim() === label)[0];
const rows = (root: FakeElement) => root.querySelectorAll("li[data-pair]");
const rowOf = (root: FakeElement, id: string) => rows(root).find((el) => el.getAttribute("data-pair") === id);
const openButtonOf = (root: FakeElement, id: string) => rowOf(root, id)!.querySelector("button")!;
const dialog = () => fakeDocument.body.findAll((el) => el.getAttribute("role") === "dialog")[0];
const stitchOf = (root: FakeElement) => root.findAll((el) => el.hasClass("thread"))[0]?.getAttribute("data-stitch");
const arcs = (root: FakeElement) => root.findAll((el) => el.hasClass("loom-arc"));
const pressed = (root: FakeElement) => root.findAll((el) => el.tagName === "BUTTON" && el.hasAttribute("aria-pressed")).map((el) => el.textContent.trim());
const focused = () => {
  const el = fakeDocument.activeElement;
  if (!el || el === fakeDocument.body) return "body";
  return `${el.tagName}:${el.getAttribute("aria-label") ?? el.textContent.trim()}`;
};

// window は最小のスタブ。keydown の受け手を集めて Esc を送れるようにする
let listeners: Map<string, Set<(e: unknown) => void>>;
const pressKey = (key: string) => listeners.get("keydown")?.forEach((fn) => fn({ key }));

beforeEach(() => {
  resetFakeDocument();
  vi.stubGlobal("document", fakeDocument);
  listeners = new Map();
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => listeners.get(type)?.delete(fn),
    dispatchEvent: vi.fn(),
  });
  connections.mockReset();
  recallFeedback.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const open = async (items: Connection[]) => {
  connections.mockResolvedValue({ items, beads });
  const view = mount(ConnectionsScreen);
  await settle();
  return view;
};

describe("S5 つながりの一覧", () => {
  it("糸が 0 本なら、添え書き・帯・一覧を出さず「まだ、つながっていません。」と「きょうのひとことから」（#today）だけ", async () => {
    const { container, errors } = await open([]);
    expect(byTag(container, "H1").map((el) => el.textContent)).toEqual(["つながり"]);
    expect(container.textContent).toContain("まだ、つながっていません。");
    expect(container.textContent).not.toContain("書いたひとことと、そのとき浮かんだ昔のひとこと");
    const link = container.querySelector('a[href="#today"]');
    expect(link?.textContent).toBe("きょうのひとことから");
    expect(byTag(container, "OL")).toEqual([]);
    expect(byTag(container, "FIGURE")).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("読み込み中は初回だけ「よみこみ中」、失敗したら「読み込めませんでした」と「もう一度」", async () => {
    const answer = deferred<ConnectionsResponse>();
    connections.mockReturnValue(answer.promise);
    const { container, errors } = mount(ConnectionsScreen);
    await settle();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("よみこみ中");
    answer.reject(new Error("network"));
    await settle();
    expect(container.textContent).toContain("読み込めませんでした");
    connections.mockResolvedValue({ items: [pair("r1")], beads });
    button(container, "もう一度")!.click();
    await settle();
    expect(rows(container)).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("1 組: 新しい日付 → 本文 → 隔たり → 理由 → 昔の日付 → 本文（引用は mark）→ ひらく の順。帯は図として読み上げから外し、弧は 1 本", async () => {
    const { container, errors } = await open([pair("r1")]);
    expect(container.textContent).toContain("書いたひとことと、そのとき浮かんだ昔のひとこと");
    const ol = container.querySelector("ol")!;
    expect(ol.getAttribute("role")).toBe("list");
    expect(ol.getAttribute("aria-label")).toBe("つながりの一覧");
    const row = rowOf(container, "r1")!;
    const article = row.querySelector("article")!;
    const label = row.findAll((el) => el.getAttribute("id") === article.getAttribute("aria-labelledby"))[0];
    expect(label?.textContent).toBe("2025年11月7日のひとこと");
    const text = article.textContent;
    const order = ["2025年11月7日のひとこと", "スーパーで青梅を見かけた", "1年5か月まえの、あのとき", "祖母と梅干し", "2024年6月のひとこと", "縁側で梅干し", "ひらく ›"];
    const at = order.map((s) => text.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(row.querySelector("mark")?.textContent).toBe("青梅を水に浸けて、ひとつずつヘタを取るのを手伝った。");
    const openBtn = row.querySelector("button")!;
    expect(openBtn.getAttribute("aria-label")).toBe("ひらく、2025年11月7日と2024年6月のつながり");
    expect(openBtn.getAttribute("aria-haspopup")).toBe("dialog");
    // 糸と結び目は読み上げない。確かめる前はしつけ糸で、判は無い
    expect(row.findAll((el) => el.hasClass("thread"))[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(stitchOf(row)).toBe("basting");
    expect(row.querySelector("[data-stamp]")).toBeNull();
    const figure = container.querySelector("figure")!;
    expect(figure.getAttribute("aria-hidden")).toBe("true");
    expect(arcs(figure).map((el) => el.getAttribute("data-stitch"))).toEqual(["basting"]);
    expect(errors).toEqual([]);
  });

  it("確かめた糸は本縫いと判（「✓ そうだった」）。「いつだったか」を含む組は隔たりを出さず、帯にも置かない（一覧には出る）", async () => {
    const unknown = pair("r2", {
      related_memory: { id: "r2_old", body: "新しい靴を買った。少しきつい。", happened_on: null, happened_on_precision: "unknown", photo_key: null },
      evidence: "新しい靴を買った。",
    });
    const { container, errors } = await open([pair("r1", { feedback: "helpful" }), unknown]);
    const sewn = rowOf(container, "r1")!;
    expect(stitchOf(sewn)).toBe("sewn");
    const stamp = sewn.querySelector("[data-stamp]")!;
    expect(stamp.textContent).toBe("✓ そうだった");
    expect(stamp.hasClass("shadow-stamp")).toBe(true);
    const row2 = rowOf(container, "r2")!;
    expect(row2.textContent).toContain("いつだったかのひとこと");
    expect(row2.textContent).not.toContain("あのとき");
    expect(arcs(container.querySelector("figure")!).map((el) => el.getAttribute("data-pair"))).toEqual(["r1"]);
    expect(errors).toEqual([]);
  });
});

describe("ひらいたとき（シート）", () => {
  it("組を押すと body の直下にシートが開き、見出しにフォーカス、後ろは inert。Esc で閉じて押した組へフォーカスを返す", async () => {
    const { container, errors } = await open([pair("r1"), pair("r2")]);
    const trigger = openButtonOf(container, "r2");
    trigger.focus();
    trigger.click();
    await settle();
    const sheet = dialog()!;
    expect(container.contains(sheet)).toBe(false);
    expect(sheet.getAttribute("aria-modal")).toBe("true");
    const labelledBy = sheet.getAttribute("aria-labelledby")!.split(" ");
    expect(labelledBy.map((id) => sheet.findAll((el) => el.getAttribute("id") === id)[0]?.textContent)).toEqual([
      "そういえば。",
      "1年5か月まえの、あのとき",
    ]);
    expect(focused()).toBe("H2:そういえば。");
    expect(container.hasAttribute("inert")).toBe(true); // main の親（App ではナビも入る .safe-area）
    expect(sheet.findAll((el) => el.getAttribute("data-motif") === "seal")).toHaveLength(1);
    // 紙片の「ひらく ›」はそれぞれの S3 へ。昔の方は札から開いた形（4.2）
    expect(byTag(sheet, "A").map((el) => el.getAttribute("href"))).toEqual([
      "#memory/r2_new?from=connections",
      "#memory/r2_old?from=connections&recall=r2",
    ]);
    pressKey("Escape");
    await settle();
    expect(dialog()).toBeUndefined();
    expect(container.hasAttribute("inert")).toBe(false);
    expect(focused()).toBe("BUTTON:ひらく、2025年11月7日と2024年6月のつながり");
    expect(fakeDocument.activeElement).toBe(openButtonOf(container, "r2"));
    expect(errors).toEqual([]);
  });

  it("地を押しても、「とじる」でも閉じる", async () => {
    const { container, errors } = await open([pair("r1")]);
    openButtonOf(container, "r1").click();
    await settle();
    const scrim = dialog()!.parentNode as FakeElement;
    scrim.click();
    await settle();
    expect(dialog()).toBeUndefined();
    openButtonOf(container, "r1").click();
    await settle();
    button(dialog()!, "とじる")!.click();
    await settle();
    expect(dialog()).toBeUndefined();
    expect(container.hasAttribute("inert")).toBe(false);
    expect(errors).toEqual([]);
  });

  it("「そうだった」で本縫い（シート・一覧・帯）と判。もう一度押すと none に戻す", async () => {
    recallFeedback.mockResolvedValue({});
    const { container, errors } = await open([pair("r1")]);
    openButtonOf(container, "r1").click();
    await settle();
    button(dialog()!, "そうだった")!.click();
    await settle();
    expect(recallFeedback).toHaveBeenLastCalledWith("r1", "helpful");
    expect(pressed(dialog()!)).toEqual(["そうだった"]);
    expect(stitchOf(dialog()!)).toBe("sewn");
    expect(stitchOf(rowOf(container, "r1")!)).toBe("sewn");
    expect(rowOf(container, "r1")!.querySelector("[data-stamp]")?.textContent).toBe("✓ そうだった");
    expect(arcs(container.querySelector("figure")!).map((el) => el.getAttribute("data-stitch"))).toEqual(["sewn"]);
    button(dialog()!, "そうだった")!.click();
    await settle();
    expect(recallFeedback).toHaveBeenLastCalledWith("r1", "none");
    expect(pressed(dialog()!)).toEqual([]);
    expect(stitchOf(rowOf(container, "r1")!)).toBe("basting");
    expect(rowOf(container, "r1")!.querySelector("[data-stamp]")).toBeNull();
    expect(errors).toEqual([]);
  });

  it("「関係ないかも」: 一筆箋が退き、封蝋が外れ、糸がほどける。閉じると一覧と帯から外れ、フォーカスは次の組へ", async () => {
    recallFeedback.mockResolvedValue({});
    const { container, errors } = await open([pair("r1"), pair("r2")]);
    openButtonOf(container, "r1").click();
    await settle();
    button(dialog()!, "関係ないかも")!.click();
    await settle();
    expect(recallFeedback).toHaveBeenLastCalledWith("r1", "not_related");
    const sheet = dialog()!;
    expect(pressed(sheet)).toEqual(["関係ないかも"]);
    expect(sheet.findAll((el) => el.hasClass("note"))[0]!.hasClass("note-quiet")).toBe(true);
    expect(sheet.findAll((el) => el.getAttribute("data-motif") === "seal")).toEqual([]);
    expect(stitchOf(sheet)).toBe("loose");
    expect(rowOf(container, "r1")).toBeDefined(); // 閉じるまでは一覧に残す
    button(sheet, "とじる")!.click();
    await settle();
    expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r2"]);
    expect(arcs(container.querySelector("figure")!).map((el) => el.getAttribute("data-pair"))).toEqual(["r2"]);
    expect(fakeDocument.activeElement).toBe(openButtonOf(container, "r2"));
    expect(errors).toEqual([]);
  });

  it("最後の 1 組を「関係ないかも」にして閉じると空の画面になり、フォーカスは h1 へ", async () => {
    recallFeedback.mockResolvedValue({});
    const { container, errors } = await open([pair("r1")]);
    openButtonOf(container, "r1").click();
    await settle();
    button(dialog()!, "関係ないかも")!.click();
    await settle();
    pressKey("Escape");
    await settle();
    expect(rows(container)).toEqual([]);
    expect(container.textContent).toContain("まだ、つながっていません。");
    expect(focused()).toBe("H1:つながり");
    expect(errors).toEqual([]);
  });

  it("記録に失敗したら、印を戻してボタンの下に「記録できませんでした」（role=status）", async () => {
    const answer = deferred<unknown>();
    recallFeedback.mockReturnValue(answer.promise);
    const { container, errors } = await open([pair("r1")]);
    openButtonOf(container, "r1").click();
    await settle();
    button(dialog()!, "そうだった")!.click();
    await settle();
    expect(pressed(dialog()!)).toEqual(["そうだった"]); // 押した直後は印を付ける
    answer.reject(new Error("500"));
    await settle();
    const sheet = dialog()!;
    expect(pressed(sheet)).toEqual([]);
    expect(stitchOf(sheet)).toBe("basting");
    expect(sheet.querySelector('[role="status"]')?.textContent).toBe("記録できませんでした");
    expect(stitchOf(rowOf(container, "r1")!)).toBe("basting");
    expect(errors).toEqual([]);
  });

  it("「関係ないかも」で閉じて外した後に記録が失敗したら、組を元の印で一覧に戻す", async () => {
    const answer = deferred<unknown>();
    recallFeedback.mockReturnValue(answer.promise);
    const { container, errors } = await open([pair("r1"), pair("r2")]);
    openButtonOf(container, "r1").click();
    await settle();
    button(dialog()!, "関係ないかも")!.click();
    await settle();
    button(dialog()!, "とじる")!.click();
    await settle();
    expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r2"]);
    answer.reject(new Error("network"));
    await settle();
    expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r1", "r2"]);
    expect(stitchOf(rowOf(container, "r1")!)).toBe("basting");
    expect(errors).toEqual([]);
  });
});

describe("動き", () => {
  // KeepAlive で残した画面を、ほかの画面と行き来させる（App.vue の代わり）
  const host = () => {
    const shown = ref<"connections" | "other">("connections");
    const Other = defineComponent({ name: "OtherScreen", render: () => h("main", [h("h1", "これまで")]) });
    const App = defineComponent({
      setup: () => () => h(KeepAlive, { include: "ConnectionsScreen" }, [shown.value === "connections" ? h(ConnectionsScreen) : h(Other)]),
    });
    return { App, shown };
  };

  it("最初の表示だけ組が順に現れて糸が描かれる。戻ったときは裏で取り直して入れ替えるだけで動かさない", async () => {
    // 動きを減らす設定ではない端末
    (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = () => ({ matches: false });
    connections.mockResolvedValue({ items: [pair("r1")], beads });
    const { App, shown } = host();
    const { container, errors } = mount(App);
    await settle();
    expect(container.querySelector("ol")!.hasClass("pairs-entering")).toBe(true);
    expect(container.querySelector("figure")!.hasClass("loom-entering")).toBe(true);
    shown.value = "other";
    await settle();
    connections.mockResolvedValue({ items: [pair("r3"), pair("r1", { feedback: "helpful" })], beads });
    shown.value = "connections";
    await settle();
    expect(connections).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="status"]')).toBeNull(); // 「よみこみ中」は出さない
    expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r3", "r1"]);
    expect(stitchOf(rowOf(container, "r1")!)).toBe("sewn");
    expect(container.querySelector("ol")!.hasClass("pairs-entering")).toBe(false);
    expect(container.querySelector("figure")!.hasClass("loom-entering")).toBe(false);
    expect(errors).toEqual([]);
  });

  it("シートを開いたまま画面を離れたら（シートの「ひらく ›」で S3 へ）、シートを閉じて inert を外す", async () => {
    connections.mockResolvedValue({ items: [pair("r1")], beads });
    const { App, shown } = host();
    const { container, errors } = mount(App);
    await settle();
    openButtonOf(container, "r1").click();
    await settle();
    expect(container.hasAttribute("inert")).toBe(true);
    shown.value = "other";
    await settle();
    expect(dialog()).toBeUndefined();
    expect(container.hasAttribute("inert")).toBe(false);
    expect(errors).toEqual([]);
  });
});

describe("下部ナビ（3 つ）", () => {
  it("きょう / これまで / つながり。どれも項目の高さは 58px で折り返さず、選択中は aria-current と太字と白抜き", async () => {
    for (const current of ["today", "past", "connections"] as const) {
      const { container, errors } = mount(BottomNav, { current });
      await nextTick();
      const nav = container.querySelector("nav")!;
      expect(nav.hasClass("pt-1") && nav.hasClass("pb-[max(env(safe-area-inset-bottom),6px)]")).toBe(true);
      const links = nav.findAll((el) => el.tagName === "A");
      expect(links.map((el) => el.textContent.trim())).toEqual(["きょう", "これまで", "つながり"]);
      expect(links.map((el) => el.getAttribute("href"))).toEqual(["#today", "#past", "#connections"]);
      expect(links.every((el) => el.hasClass("h-[58px]") && el.hasClass("whitespace-nowrap"))).toBe(true);
      const now = links.filter((el) => el.getAttribute("aria-current") === "page");
      expect(now.map((el) => el.getAttribute("href"))).toEqual([`#${current}`]);
      expect(now[0]!.hasClass("font-bold")).toBe(true);
      expect(now[0]!.findAll((el) => el.hasClass("fill-card")).length).toBeGreaterThan(0);
      expect(links.filter((el) => el !== now[0]).flatMap((el) => el.findAll((c) => c.hasClass("fill-card")))).toEqual([]);
      expect(errors).toEqual([]);
    }
  });
});
