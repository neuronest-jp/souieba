// S5 つながり（ADR-0009、wireframes 5 節）。空・1 組・反応（そうだった → 判と本縫い、関係ないかも → 閉じたら外れる、失敗で戻る）、
// シートのフォーカスと inert、最初の表示だけ動かすこと、下部ナビの 3 つめ。DOM は web/test/fakeDom.ts の最小のもの。
// 見た目の細部（糸の線の種類や色）はブラウザで撮って確かめる。ここでは data-stitch と判・封蝋の有無で形の区別を固定する
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, KeepAlive, nextTick, ref } from "vue";
import type { Connection, ConnectionsResponse } from "../src/api/types";
import { layoutLoom } from "../src/connections/loom";
import { fakeDocument, mount, resetFakeDocument, type FakeElement } from "./fakeDom";

const { connections, recallFeedback, haptic } = vi.hoisted(() => ({
  connections: vi.fn<() => Promise<ConnectionsResponse>>(),
  recallFeedback: vi.fn<(id: string, feedback: string) => Promise<unknown>>(),
  haptic: { tap: vi.fn(), select: vi.fn(), stamp: vi.fn(), saved: vi.fn(), arrive: vi.fn(), failed: vi.fn() },
}));
vi.mock("../src/api", () => ({
  ApiError: class extends Error {},
  api: {
    connections: () => connections(),
    recallFeedback: (id: string, feedback: string) => recallFeedback(id, feedback),
  },
}));
// 触覚は手ざわりの名前で呼ばれたかだけを見る（@capacitor/haptics は読まない）
vi.mock("../src/haptics", () => haptic);

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
  Object.values(haptic).forEach((fn) => fn.mockReset());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// KeepAlive で残した画面を、ほかの画面と行き来させる（App.vue の代わり。shown を other にするとシートの「ひらく ›」で S3 へ行ったのと同じ）
const host = () => {
  const shown = ref<"connections" | "other">("connections");
  const Other = defineComponent({ name: "OtherScreen", render: () => h("main", [h("h1", "これまで")]) });
  const App = defineComponent({
    setup: () => () => h(KeepAlive, { include: "ConnectionsScreen" }, [shown.value === "connections" ? h(ConnectionsScreen) : h(Other)]),
  });
  return { App, shown };
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// 動きを減らす設定ではない端末にする（既定は matchMedia が無く、待たずに切り替える）
const motionOn = () => {
  (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = () => ({ matches: false });
};
// 最小の DOM の要素に、書き込むだけの style を持たせる（シートの紙と地）
const withStyle = (panel: FakeElement) => {
  const targets = [panel, ...(panel.parentNode as FakeElement).children];
  for (const el of targets) (el as unknown as { style: Record<string, string> }).style ??= {};
};
const stamps = (root: FakeElement) => root.findAll((el) => el.hasAttribute("data-stamp")).length;
// 画面に常に置く知らせ（シートの外。読み上げ用）と、組の下の見える知らせ
const liveNotice = (root: FakeElement) => root.findAll((el) => el.getAttribute("role") === "status" && el.hasAttribute("data-live"))[0];
const rowNotice = (root: FakeElement, id: string) => rowOf(root, id)?.findAll((el) => el.hasAttribute("data-notice"))[0];

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
    expect(container.textContent).not.toContain("そういえば、で結ばれたふたつの日");
    const link = container.querySelector('a[href="#today"]');
    expect(link?.textContent).toBe("きょうのひとことから");
    expect(byTag(container, "OL")).toEqual([]);
    expect(byTag(container, "FIGURE")).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("昔のことを書いて、後の日の記憶を思い出した組は、起きた日の順に上下を入れ替える（印と札の形のリンクは思い出された側に付いたまま）", async () => {
    // 11/7 実機: 2019 年の引っ越しを書き、2026 年 7 月の冷蔵庫を思い出した組が、上に 2019 年・「7年3か月あとの」と逆に見えた
    const flipped = pair("r9", {
      evidence: "冷蔵庫が壊れた。",
      memory: { id: "moved", body: "アパートに引っ越した。家電を買った。", happened_on: "2019-04-07", happened_on_precision: "day", photo_key: null },
      related_memory: { id: "fridge", body: "冷蔵庫が壊れた。新しいのを注文したけど、届くのは来週。", happened_on: "2025-07-19", happened_on_precision: "day", photo_key: null },
    });
    const { container, errors } = await open([flipped]);
    const row = rowOf(container, "r9")!;
    const article = row.querySelector("article")!;
    const label = row.findAll((el) => el.getAttribute("id") === article.getAttribute("aria-labelledby"))[0];
    expect(label?.textContent).toBe("2025年7月19日のひとこと");
    expect(row.textContent).toContain("6年3か月まえの、あのとき");
    expect(row.textContent).not.toContain("あとの");
    // 印は上の紙片（思い出された側）に付く
    const upper = row.findAll((el) => el.hasClass("card"))[0]!;
    expect(upper.findAll((el) => el.tagName === "MARK").map((el) => el.textContent)).toEqual(["冷蔵庫が壊れた。"]);
    expect(row.findAll((el) => el.hasClass("note"))[0]!.findAll((el) => el.tagName === "MARK")).toEqual([]);
    expect(openButtonOf(container, "r9").getAttribute("aria-label")).toBe("ひらく、2025年7月19日と2019年4月7日のつながり");
    // シート: 上の「ひらく ›」が札の形（?recall=）、下は書いた方の S3
    openButtonOf(container, "r9").click();
    await settle();
    const links = dialog()!.findAll((el) => el.tagName === "A").map((el) => el.getAttribute("href"));
    expect(links).toEqual(["#memory/fridge?from=connections&recall=r9", "#memory/moved?from=connections"]);
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
    expect(container.textContent).toContain("そういえば、で結ばれたふたつの日");
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
    // 地は、シートの置き場の中のパネルの後ろの層（useSheetDrag の .sheet-backdrop）
    const backdrop = (dialog()!.parentNode as FakeElement).findAll((el) => el.hasClass("sheet-backdrop"))[0]!;
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
    backdrop.click();
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

describe("記録と取り直しが重なったとき（利用者の反応を黙って取り消さない）", () => {
  it("取り直しの GET が返る前に「関係ないかも」で閉じても、先に読まれた古い結果で組を戻さない。静かになってから取り直す", async () => {
    recallFeedback.mockResolvedValue({});
    connections.mockResolvedValue({ items: [pair("r1"), pair("r2")], beads });
    const { App, shown } = host();
    const { container, errors } = mount(App);
    await settle();
    shown.value = "other";
    await settle();
    const stale = deferred<ConnectionsResponse>();
    connections.mockReturnValueOnce(stale.promise);
    shown.value = "connections"; // 戻ったときの取り直し（遅い回線で返っていない）
    await settle();
    openButtonOf(container, "r1").click();
    await settle();
    button(dialog()!, "関係ないかも")!.click();
    await settle();
    connections.mockResolvedValue({ items: [pair("r2")], beads }); // 記録のあとのサーバ
    button(dialog()!, "とじる")!.click();
    await settle();
    expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r2"]);
    stale.resolve({ items: [pair("r1"), pair("r2")], beads }); // 記録より前に読まれた結果
    await settle();
    expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r2"]);
    expect(arcs(container.querySelector("figure")!).map((el) => el.getAttribute("data-pair"))).toEqual(["r2"]);
    expect(connections).toHaveBeenCalledTimes(3); // 最初・戻ったとき・閉じたあとの取り直し
    expect(errors).toEqual([]);
  });

  it("取り直しの GET が返る前に「そうだった」で閉じても、古い結果で判と本縫いを消さない", async () => {
    recallFeedback.mockResolvedValue({});
    connections.mockResolvedValue({ items: [pair("r1"), pair("r2")], beads });
    const { App, shown } = host();
    const { container, errors } = mount(App);
    await settle();
    shown.value = "other";
    await settle();
    const stale = deferred<ConnectionsResponse>();
    connections.mockReturnValueOnce(stale.promise);
    shown.value = "connections";
    await settle();
    openButtonOf(container, "r1").click();
    await settle();
    button(dialog()!, "そうだった")!.click();
    await settle();
    connections.mockResolvedValue({ items: [pair("r1", { feedback: "helpful" }), pair("r2")], beads });
    button(dialog()!, "とじる")!.click();
    await settle();
    stale.resolve({ items: [pair("r1"), pair("r2")], beads });
    await settle();
    expect(stitchOf(rowOf(container, "r1")!)).toBe("sewn");
    expect(stamps(rowOf(container, "r1")!)).toBe(1);
    expect(errors).toEqual([]);
  });

  it("記録の最中に戻ったときの取り直しが返っても、外した組を一覧に戻さない（記録が済んでから取り直す）", async () => {
    const write = deferred<unknown>();
    recallFeedback.mockReturnValue(write.promise);
    connections.mockResolvedValue({ items: [pair("r1"), pair("r2")], beads });
    const { App, shown } = host();
    const { container, errors } = mount(App);
    await settle();
    openButtonOf(container, "r1").click();
    await settle();
    button(dialog()!, "関係ないかも")!.click();
    await settle();
    shown.value = "other"; // シートの「ひらく ›」で S3 へ（シートは閉じ、組は外れる）
    await settle();
    shown.value = "connections"; // 記録より前に読まれた [r1, r2] が返る
    await settle();
    expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r2"]);
    connections.mockResolvedValue({ items: [pair("r2")], beads });
    write.resolve({});
    await settle();
    expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r2"]);
    expect(connections).toHaveBeenCalledTimes(3);
    expect(errors).toEqual([]);
  });

  it("「そうだった」の記録中に S3 へ行って戻り、そのあと記録が失敗したら、一覧・帯・シートとも確かめる前に戻す", async () => {
    const write = deferred<unknown>();
    recallFeedback.mockReturnValue(write.promise);
    connections.mockResolvedValue({ items: [pair("r1")], beads });
    const { App, shown } = host();
    const { container, errors } = mount(App);
    await settle();
    openButtonOf(container, "r1").click();
    await settle();
    button(dialog()!, "そうだった")!.click();
    await settle();
    shown.value = "other";
    await settle();
    shown.value = "connections"; // 取り直しが記録より先に返る
    await settle();
    write.reject(new Error("500"));
    await settle();
    expect(stitchOf(rowOf(container, "r1")!)).toBe("basting");
    expect(stamps(container)).toBe(0);
    expect(arcs(container.querySelector("figure")!).map((el) => el.getAttribute("data-stitch"))).toEqual(["basting"]);
    expect(rowNotice(container, "r1")?.textContent).toBe("記録できませんでした");
    expect(haptic.failed).toHaveBeenCalledTimes(1);
    openButtonOf(container, "r1").click();
    await settle();
    expect(pressed(dialog()!)).toEqual([]);
    expect(stitchOf(dialog()!)).toBe("basting");
    expect(errors).toEqual([]);
  });

  it("戻った直後に組を開いて取り直しの結果を見送ったら、シートを閉じたあとで取り直す（S3 で返した反応を映す）", async () => {
    connections.mockResolvedValue({ items: [pair("r1"), pair("r2")], beads });
    const { App, shown } = host();
    const { container, errors } = mount(App);
    await settle();
    shown.value = "other"; // S3 で r1 を「そうだった」にした
    await settle();
    const late = deferred<ConnectionsResponse>();
    connections.mockReturnValueOnce(late.promise);
    shown.value = "connections";
    await settle();
    openButtonOf(container, "r2").click();
    await settle();
    late.resolve({ items: [pair("r1", { feedback: "helpful" }), pair("r2")], beads }); // シートが開いているので見送る
    await settle();
    expect(stitchOf(rowOf(container, "r1")!)).toBe("basting");
    connections.mockResolvedValue({ items: [pair("r1", { feedback: "helpful" }), pair("r2")], beads });
    button(dialog()!, "とじる")!.click();
    await settle();
    expect(connections).toHaveBeenCalledTimes(3);
    expect(stitchOf(rowOf(container, "r1")!)).toBe("sewn");
    expect(stamps(rowOf(container, "r1")!)).toBe(1);
    expect(errors).toEqual([]);
  });
});

describe("記録の失敗を知らせる（シートを閉じたあとでも）", () => {
  it("画面には読み上げ用の知らせ（role=status）を初めから置いておく（後から差し込んだ所は読まれないことがある）", async () => {
    const { container, errors } = await open([pair("r1")]);
    const live = liveNotice(container)!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.hasClass("sr-only")).toBe(true);
    expect(live.textContent).toBe("");
    expect(errors).toEqual([]);
  });

  it("「そうだった」→ とじる → 失敗: 判を外し、組の下と画面の知らせに「記録できませんでした」、触覚は failed。その組をもう一度ひらくと組の下の知らせは消える", async () => {
    const write = deferred<unknown>();
    recallFeedback.mockReturnValue(write.promise);
    const { container, errors } = await open([pair("r1"), pair("r2")]);
    openButtonOf(container, "r1").click();
    await settle();
    button(dialog()!, "そうだった")!.click();
    await settle();
    button(dialog()!, "とじる")!.click();
    await settle();
    expect(stamps(rowOf(container, "r1")!)).toBe(1);
    write.reject(new Error("network"));
    await settle();
    expect(dialog()).toBeUndefined();
    expect(stamps(rowOf(container, "r1")!)).toBe(0);
    expect(stitchOf(rowOf(container, "r1")!)).toBe("basting");
    expect(rowNotice(container, "r1")?.textContent).toBe("記録できませんでした");
    expect(rowNotice(container, "r2")).toBeUndefined();
    expect(liveNotice(container)!.textContent).toBe("記録できませんでした");
    expect(haptic.failed).toHaveBeenCalledTimes(1);
    expect(focused()).toBe("BUTTON:ひらく、2025年11月7日と2024年6月のつながり");
    expect(fakeDocument.activeElement).toBe(openButtonOf(container, "r1"));
    // ひらいたら一覧の知らせは外す（シートの中では同じ知らせをボタンの下に出す）
    openButtonOf(container, "r1").click();
    await settle();
    expect(rowNotice(container, "r1")).toBeUndefined();
    expect(liveNotice(container)!.textContent).toBe("");
    expect(dialog()!.querySelector('[role="status"]')?.textContent).toBe("記録できませんでした");
    expect(errors).toEqual([]);
  });

  it("「関係ないかも」→ とじる → 失敗: 組を元の印で戻し、組の下に「記録できませんでした」。フォーカスは次の組のまま動かさない", async () => {
    const write = deferred<unknown>();
    recallFeedback.mockReturnValue(write.promise);
    const { container, errors } = await open([pair("r1"), pair("r2")]);
    openButtonOf(container, "r1").click();
    await settle();
    button(dialog()!, "関係ないかも")!.click();
    await settle();
    button(dialog()!, "とじる")!.click();
    await settle();
    expect(fakeDocument.activeElement).toBe(openButtonOf(container, "r2"));
    write.reject(new Error("network"));
    await settle();
    expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r1", "r2"]);
    expect(rowNotice(container, "r1")?.textContent).toBe("記録できませんでした");
    expect(liveNotice(container)!.textContent).toBe("記録できませんでした");
    expect(fakeDocument.activeElement).toBe(openButtonOf(container, "r2"));
    expect(errors).toEqual([]);
  });

  it("動きのある設定で、閉じた組が抜けている途中に失敗したら、組を戻してフォーカスをその組の「ひらく」へ", async () => {
    motionOn();
    const write = deferred<unknown>();
    recallFeedback.mockReturnValue(write.promise);
    const { container, errors } = await open([pair("r1"), pair("r2")]);
    openButtonOf(container, "r1").click();
    await settle();
    button(dialog()!, "関係ないかも")!.click();
    await settle();
    withStyle(dialog()!); // 動きのある設定では useSheetDrag が紙と地の style を書く（最小の DOM は style を持たない）
    button(dialog()!, "とじる")!.click();
    await wait(320); // シートが下がりきって、組が抜け始める
    await settle();
    expect(dialog()).toBeUndefined();
    expect(rowOf(container, "r1")!.hasClass("pair-unravel")).toBe(true);
    write.reject(new Error("network"));
    await settle();
    await wait(340);
    await settle();
    expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r1", "r2"]);
    expect(rowOf(container, "r1")!.hasClass("pair-unravel")).toBe(false);
    expect(fakeDocument.activeElement).toBe(openButtonOf(container, "r1"));
    expect(errors).toEqual([]);
  });

  it("動きのある設定で、抜けている途中の組をもう一度ひらいて「関係ないかも」を取り消したら、組を一覧に残してフォーカスをその組へ返す", async () => {
    // 見直し 4 回目: 先に予約された抜ける動きの終わりが、ひらき直した組を一覧から外したまま戻さなかった
    motionOn();
    recallFeedback.mockResolvedValue({});
    const { container, errors } = await open([pair("r1"), pair("r2")]);
    openButtonOf(container, "r1").click();
    await settle();
    button(dialog()!, "関係ないかも")!.click();
    await settle();
    withStyle(dialog()!);
    button(dialog()!, "とじる")!.click();
    await wait(300); // シートが下がりきって、組が抜け始める
    await settle();
    expect(dialog()).toBeUndefined();
    expect(rowOf(container, "r1")!.hasClass("pair-unravel")).toBe(true);
    openButtonOf(container, "r1").click(); // 薄れていく組を押す
    await settle();
    expect(dialog()).toBeDefined();
    expect(rowOf(container, "r1")!.hasClass("pair-unravel")).toBe(false); // 抜ける動きは取り消す
    await wait(340); // 先に予約した抜ける動きの終わりが過ぎる
    await settle();
    expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r1", "r2"]);
    button(dialog()!, "関係ないかも")!.click(); // 取り消して none に戻す
    await settle();
    expect(recallFeedback).toHaveBeenLastCalledWith("r1", "none");
    withStyle(dialog()!); // ひらき直したシートは新しい紙
    button(dialog()!, "とじる")!.click();
    await wait(340);
    await settle();
    expect(dialog()).toBeUndefined();
    expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r1", "r2"]);
    expect(rowOf(container, "r1")!.hasClass("pair-unravel")).toBe(false);
    expect(fakeDocument.activeElement).toBe(openButtonOf(container, "r1"));
    expect(arcs(container.querySelector("figure")!).map((el) => el.getAttribute("data-pair"))).toEqual(["r1", "r2"]);
    expect(errors).toEqual([]);
  });

  it("動きのある設定で、抜けている途中の組をひらき直しても「関係ないかも」のまま閉じたら、そのとき改めて外す", async () => {
    motionOn();
    recallFeedback.mockResolvedValue({});
    const { container, errors } = await open([pair("r1"), pair("r2")]);
    openButtonOf(container, "r1").click();
    await settle();
    button(dialog()!, "関係ないかも")!.click();
    await settle();
    withStyle(dialog()!);
    button(dialog()!, "とじる")!.click();
    await wait(300);
    await settle();
    openButtonOf(container, "r1").click();
    await settle();
    await wait(340);
    await settle();
    expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r1", "r2"]); // 開いている間は外さない
    withStyle(dialog()!);
    button(dialog()!, "とじる")!.click();
    await wait(300);
    await settle();
    expect(rowOf(container, "r1")!.hasClass("pair-unravel")).toBe(true);
    await wait(340);
    await settle();
    expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r2"]);
    expect(fakeDocument.activeElement).toBe(openButtonOf(container, "r2"));
    expect(recallFeedback).toHaveBeenCalledTimes(1); // 開き直して閉じただけでは記録しない
    expect(errors).toEqual([]);
  });

  // 「そうだった」に戻した失敗でも、判と知らせを両方出す（判の分岐が先に当たって知らせが消えていた。見直し 4 回目）
  for (const [label, act] of [
    ["「そうだった」の組を「関係ないかも」にして", "関係ないかも"],
    ["「そうだった」を取り消して", "そうだった"],
  ] as const) {
    it(`${label} とじる → 失敗: 判を戻し、組の足に判と「記録できませんでした」を並べる（判 → 知らせ → ひらく の順。「ひらく ›」は押し出さない）`, async () => {
      const write = deferred<unknown>();
      recallFeedback.mockReturnValue(write.promise);
      const { container, errors } = await open([pair("r1", { feedback: "helpful" }), pair("r2")]);
      openButtonOf(container, "r1").click();
      await settle();
      button(dialog()!, act)!.click();
      await settle();
      button(dialog()!, "とじる")!.click();
      await settle();
      write.reject(new Error("network"));
      await settle();
      expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r1", "r2"]);
      const row = rowOf(container, "r1")!;
      expect(stamps(row)).toBe(1);
      expect(stitchOf(row)).toBe("sewn");
      const notice = rowNotice(container, "r1")!;
      expect(notice?.textContent).toBe("記録できませんでした");
      const text = row.querySelector("article")!.textContent;
      const at = ["✓ そうだった", "記録できませんでした", "ひらく ›"].map((s) => text.indexOf(s));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect(at).toEqual([...at].sort((a, b) => a - b));
      // 判と知らせは折り返せる箱に入れ、「ひらく ›」は縮めない（375pt の幅では知らせが判の下の行へ回る）
      const box = notice.parentNode as FakeElement;
      expect(box.hasClass("flex-wrap") && box.hasClass("min-w-0")).toBe(true);
      expect(box.querySelector("[data-stamp]")).not.toBeNull();
      expect(openButtonOf(container, "r1").hasClass("shrink-0")).toBe(true);
      expect(errors).toEqual([]);
    });
  }

  // シートが下がっていく 280ms の間の失敗は、閉じたシートの分として組の足に出す（見直し 4 回目）
  for (const act of ["そうだった", "関係ないかも"] as const) {
    it(`動きのある設定で「${act}」→ とじる → シートが下がる途中に失敗: 閉じたあと組の足に「記録できませんでした」を残す`, async () => {
      motionOn();
      const write = deferred<unknown>();
      recallFeedback.mockReturnValue(write.promise);
      const { container, errors } = await open([pair("r1"), pair("r2")]);
      openButtonOf(container, "r1").click();
      await settle();
      button(dialog()!, act)!.click();
      await settle();
      withStyle(dialog()!);
      button(dialog()!, "とじる")!.click();
      write.reject(new Error("network")); // 紙が下がりきる前に返る
      await settle();
      expect(dialog()).toBeDefined(); // まだ下がっている途中
      expect(dialog()!.querySelector('[role="status"]')?.textContent).toBe("記録できませんでした");
      await wait(320);
      await settle();
      expect(dialog()).toBeUndefined();
      expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r1", "r2"]);
      expect(stamps(rowOf(container, "r1")!)).toBe(0);
      expect(stitchOf(rowOf(container, "r1")!)).toBe("basting");
      expect(rowNotice(container, "r1")?.textContent).toBe("記録できませんでした");
      expect(rowNotice(container, "r2")).toBeUndefined();
      expect(haptic.failed).toHaveBeenCalledTimes(1);
      expect(errors).toEqual([]);
    });
  }

  it("触覚: 「そうだった」で stamp、「関係ないかも」と取り消しで tap（押した直後に 1 回）", async () => {
    recallFeedback.mockResolvedValue({});
    const { container, errors } = await open([pair("r1")]);
    openButtonOf(container, "r1").click();
    await settle();
    button(dialog()!, "そうだった")!.click();
    expect(haptic.stamp).toHaveBeenCalledTimes(1);
    expect(haptic.tap).toHaveBeenCalledTimes(0);
    await settle();
    button(dialog()!, "そうだった")!.click(); // 取り消し
    await settle();
    button(dialog()!, "関係ないかも")!.click();
    await settle();
    expect(haptic.stamp).toHaveBeenCalledTimes(1);
    expect(haptic.tap).toHaveBeenCalledTimes(2);
    expect(haptic.failed).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });
});

describe("引用の印（色だけに頼らない・4 行の中に入れる）", () => {
  it("引用は mark の前後に読み上げ用の「」を置く（一覧とシート。mark の中は引用そのまま）", async () => {
    const { container, errors } = await open([pair("r1")]);
    const row = rowOf(container, "r1")!;
    const evidence = "青梅を水に浸けて、ひとつずつヘタを取るのを手伝った。";
    expect(row.textContent).toContain(`「${evidence}」`);
    expect(row.querySelector("mark")?.textContent).toBe(evidence);
    const quotes = row.findAll((el) => el.hasClass("sr-only") && /^[「」]$/.test(el.textContent));
    expect(quotes.map((el) => el.textContent)).toEqual(["「", "」"]);
    openButtonOf(container, "r1").click();
    await settle();
    expect(dialog()!.textContent).toContain(`「${evidence}」`);
    expect(dialog()!.querySelector("mark")?.textContent).toBe(evidence);
    expect(errors).toEqual([]);
  });

  it("一覧では 56 字を超える本文を引用の前後に寄せる（引用が末尾の 70 字の本文でも、4 行の中に印が入る）", async () => {
    const evidence = "店主は私を覚えていた。";
    const body = `${"昔よく通った駅前の喫茶店に久しぶりに入った。".repeat(2)}窓際の席は変わらずそこにあった。${evidence}`;
    expect([...body].length).toBeGreaterThan(56);
    expect([...body].length).toBeLessThanOrEqual(80);
    const p = pair("r1", { evidence, related_memory: { id: "cafe", body, happened_on: "2024-06-01", happened_on_precision: "month", photo_key: null } });
    const { container, errors } = await open([p]);
    const note = rowOf(container, "r1")!.findAll((el) => el.hasClass("note"))[0]!;
    const text = note.findAll((el) => el.tagName === "P")[1]!.textContent;
    expect(text.startsWith("…")).toBe(true);
    expect([...text.replace(/[「」]/g, "")].length).toBeLessThanOrEqual(56 + 1);
    expect(note.querySelector("mark")?.textContent).toBe(evidence);
    expect(errors).toEqual([]);
  });
});

describe("帯を押したとき", () => {
  // 最小の DOM の click は座標を持たないので、帯の svg の受け手を座標付きで直に呼ぶ
  const pressAt = (svg: FakeElement, x: number, y: number) => {
    const listeners = (svg as unknown as { listeners: Map<string, Array<{ fn: (e: unknown) => void }>> }).listeners.get("click") ?? [];
    listeners.forEach((l) => l.fn({ clientX: x, clientY: y }));
  };
  const older = pair("r2", {
    evidence: "雪だるまを作った。",
    related_memory: { id: "snow", body: "雪だるまを作った。にんじんの鼻。", happened_on: "2023-01-10", happened_on_precision: "day", photo_key: null },
  });

  it("弧を押すと、その組へ一覧を動かし、組と弧がほのかに光る（触覚は select）。何も無い所を押しても何もしない", async () => {
    const { container, errors } = await open([pair("r1"), older]);
    const figure = container.querySelector("figure")!;
    expect(figure.getAttribute("aria-hidden")).toBe("true"); // 押せても読み上げには出さない（同じ組は一覧にある）
    const svg = figure.querySelector("svg")!;
    const scroller = figure as FakeElement & { scrollLeft: number };
    const layout = layoutLoom({ beads, items: [pair("r1"), older], width: 362, scroll: true });
    (scroller as unknown as { getBoundingClientRect: () => object }).getBoundingClientRect = () => ({ left: 0, top: 0, width: layout.view, height: layout.height });
    const shift = scroller.scrollLeft;
    const row = rowOf(container, "r2")!;
    const scrolled = vi.fn();
    (row as unknown as { scrollIntoView: typeof scrolled }).scrollIntoView = scrolled;
    const arc = layout.arcs.find((a) => a.id === "r2")!;
    pressAt(svg, (arc.x1 + arc.x2) / 2 - shift, layout.baseline - arc.height);
    await settle();
    expect(scrolled).toHaveBeenCalledWith({ behavior: "auto", block: "start" }); // 動きを減らす設定では、なめらかにせず飛ぶ
    expect(rowOf(container, "r2")!.hasClass("pair-glow")).toBe(true);
    expect(rowOf(container, "r1")!.hasClass("pair-glow")).toBe(false);
    expect(arcs(figure).filter((el) => el.hasClass("arc-glow")).map((el) => el.getAttribute("data-pair"))).toEqual(["r2"]);
    expect(haptic.select).toHaveBeenCalledTimes(1);
    pressAt(svg, 4, 2);
    await settle();
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(haptic.select).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it("年が多い帯は横に送れる年表になり、開いたときは新しい側（右端）を見せる。押した位置には送った量を足して当てる", async () => {
    const { container, errors } = await open([pair("r1"), older]);
    const figure = container.querySelector("figure")!;
    const scroller = figure as FakeElement & { scrollLeft: number };
    const layout = layoutLoom({ beads, items: [pair("r1"), older], width: 362, scroll: true });
    expect(layout.width).toBeGreaterThan(layout.view);
    expect(figure.hasClass("loom")).toBe(true);
    expect(scroller.scrollLeft).toBe(layout.width - layout.view); // 右端から
    expect(figure.querySelector("svg")!.getAttribute("width")).toBe(String(layout.width));
    (scroller as unknown as { getBoundingClientRect: () => object }).getBoundingClientRect = () => ({ left: 0, top: 0, width: layout.view, height: layout.height });
    const row = rowOf(container, "r2")!;
    const scrolled = vi.fn();
    (row as unknown as { scrollIntoView: typeof scrolled }).scrollIntoView = scrolled;
    // 左の端まで送ってから、古い端（2023 年）の近くの弧を押す
    scroller.scrollLeft = 0;
    const arc = layout.arcs.find((a) => a.id === "r2")!;
    const svg = figure.querySelector("svg")!;
    await wait(200); // 送った直後の指離れの時間を過ぎてから
    pressAt(svg, arc.x1 + 6, layout.baseline - 8);
    await settle();
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it("いま読んでいる組（focus）の弧と結び目を濃くして上に重ね、ほかを退かせる。帯が横に送れるなら、見えていない弧の昔の端の所まで送る。null で元に戻す", async () => {
    const ThreadLoom = (await import("../src/components/connections/ThreadLoom.vue")).default;
    const items = [pair("r1"), older];
    const focus = ref<string | null>(null);
    const Host = defineComponent(() => () => h(ThreadLoom, { beads, items, focus: focus.value }));
    const { container, errors } = mount(Host);
    await settle();
    const figure = container.querySelector("figure")! as FakeElement & { scrollLeft: number };
    const svg = figure.querySelector("svg")!;
    const layout = layoutLoom({ beads, items, width: 362, scroll: true });
    expect(layout.width).toBeGreaterThan(layout.view); // 2023 年からの帯は横に送れる
    expect(svg.hasAttribute("data-focus")).toBe(false);
    const startLeft = figure.scrollLeft; // 開いたときは右端
    focus.value = "r2";
    await settle();
    expect(svg.hasAttribute("data-focus")).toBe(true);
    expect(arcs(figure).filter((el) => el.hasClass("arc-focus")).map((el) => el.getAttribute("data-pair"))).toEqual(["r2"]);
    expect(arcs(figure).at(-1)!.getAttribute("data-pair")).toBe("r2"); // 最後に描いていちばん上に重ねる
    expect(figure.findAll((el) => el.hasClass("end-focus"))).toHaveLength(2);
    const arc = layout.arcs.find((a) => a.id === "r2")!;
    expect(arc.x2 - arc.x1).toBeGreaterThan(layout.view); // 見える幅に入らない長い弧
    expect(figure.scrollLeft).toBeLessThan(startLeft);
    expect(figure.scrollLeft).toBe(Math.max(0, Math.round(arc.x1 - 28))); // 思い出した昔の端を左のぼかしの内側に見せる
    focus.value = null;
    await settle();
    expect(svg.hasAttribute("data-focus")).toBe(false);
    expect(arcs(figure).some((el) => el.hasClass("arc-focus"))).toBe(false);
    expect(errors).toEqual([]);
  });

  it("一覧で組をひらくと、帯もその組の弧が見える所まで送る（reveal）", async () => {
    const { container, errors } = await open([pair("r1"), older]);
    const figure = container.querySelector("figure")! as FakeElement & { scrollLeft: number };
    const layout = layoutLoom({ beads, items: [pair("r1"), older], width: 362, scroll: true });
    expect(figure.scrollLeft).toBe(layout.width - layout.view);
    const arc = layout.arcs.find((a) => a.id === "r2")!;
    const lo = Math.min(arc.x1, arc.x2) - 28;
    const hi = Math.max(arc.x1, arc.x2) + 28;
    expect(lo).toBeLessThan(figure.scrollLeft); // 右端からはこの弧が収まっていない
    openButtonOf(container, "r2").click();
    await settle();
    // 収まるなら弧を真ん中に、収まらなければ新しい端を右のぼかしの内側に
    const want = hi - lo <= layout.view ? (lo + hi - layout.view) / 2 : hi - layout.view;
    expect(figure.scrollLeft).toBe(Math.round(Math.max(0, want)));
    expect(figure.scrollLeft).toBeLessThan(layout.width - layout.view);
    expect(errors).toEqual([]);
  });

  it("横に送った直後の指離れでは、弧を押したことにしない", async () => {
    const { container, errors } = await open([pair("r1"), older]);
    const figure = container.querySelector("figure")!;
    const scroller = figure as FakeElement & { scrollLeft: number };
    const layout = layoutLoom({ beads, items: [pair("r1"), older], width: 362, scroll: true });
    (scroller as unknown as { getBoundingClientRect: () => object }).getBoundingClientRect = () => ({ left: 0, top: 0, width: layout.view, height: layout.height });
    const row = rowOf(container, "r2")!;
    const scrolled = vi.fn();
    (row as unknown as { scrollIntoView: typeof scrolled }).scrollIntoView = scrolled;
    const fire = (el: FakeElement, type: string) =>
      ((el as unknown as { listeners: Map<string, Array<{ fn: (e: unknown) => void }>> }).listeners.get(type) ?? []).forEach((l) => l.fn({}));
    const arc = layout.arcs.find((a) => a.id === "r2")!;
    const svg = figure.querySelector("svg")!;
    // 指を置いてから送られた
    fire(scroller, "pointerdown");
    scroller.scrollLeft -= 120;
    fire(scroller, "scroll");
    pressAt(svg, (arc.x1 + arc.x2) / 2 - scroller.scrollLeft, layout.baseline - arc.height);
    await settle();
    // 送った直後（指は動かしていない）
    fire(scroller, "scroll");
    pressAt(svg, (arc.x1 + arc.x2) / 2 - scroller.scrollLeft, layout.baseline - arc.height);
    await settle();
    expect(scrolled).not.toHaveBeenCalled();
    expect(haptic.select).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });
});

describe("動き", () => {
  it("最初の表示では組が順に現れて糸が渡される。戻ったときは裏で取り直し、新しく結ばれた組だけが現れる（ほかは動かさない）", async () => {
    motionOn();
    connections.mockResolvedValue({ items: [pair("r1")], beads });
    const { App, shown } = host();
    const { container, errors } = mount(App);
    await settle();
    expect(rowOf(container, "r1")!.hasClass("pair-weave")).toBe(true);
    expect(arcs(container.querySelector("figure")!).every((el) => el.hasClass("arc-weave"))).toBe(true);
    shown.value = "other";
    await settle();
    connections.mockResolvedValue({ items: [pair("r3"), pair("r1", { feedback: "helpful" })], beads });
    shown.value = "connections";
    await settle();
    expect(connections).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("よみこみ中"); // 戻ったときは「よみこみ中」を出さない
    expect(rows(container).map((el) => el.getAttribute("data-pair"))).toEqual(["r3", "r1"]);
    expect(stitchOf(rowOf(container, "r1")!)).toBe("sewn");
    expect(rowOf(container, "r3")!.hasClass("pair-weave")).toBe(true);
    expect(rowOf(container, "r1")!.hasClass("pair-weave")).toBe(false);
    const woven = arcs(container.querySelector("figure")!).filter((el) => el.hasClass("arc-weave"));
    expect(woven.map((el) => el.getAttribute("data-pair"))).toEqual(["r3"]);
    expect(errors).toEqual([]);
  });

  it("動きを減らす設定（とテストの環境）では、最初の表示でも組と弧に動きの class を付けない", async () => {
    const { container, errors } = await open([pair("r1")]);
    expect(rowOf(container, "r1")!.hasClass("pair-weave")).toBe(false);
    expect(arcs(container.querySelector("figure")!).some((el) => el.hasClass("arc-weave"))).toBe(false);
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
