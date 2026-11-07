// 写真を添える部品（PhotoPicker）。見直し n=9 / 16（「はずす」でフォーカスが body に落ちる）、n=14（開いている間に二度押せる）、
// n=15（保存中も押せる）と、S1 の便箋の下の段の形（カメラの絵と「写真」、添えた写真は焼き付けのプリント）。DOM は web/test/fakeDom.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import type { PickedPhoto } from "../src/camera";
import { fakeDocument, mount, resetFakeDocument, type FakeElement } from "./fakeDom";

const { pickPhoto, tap } = vi.hoisted(() => ({ pickPhoto: vi.fn<() => Promise<PickedPhoto | null>>(), tap: vi.fn() }));
vi.mock("../src/camera", () => ({ pickPhoto: () => pickPhoto() }));
vi.mock("../src/haptics", () => ({ tap: () => tap(), select: vi.fn(), stamp: vi.fn(), saved: vi.fn(), arrive: vi.fn(), failed: vi.fn() }));
const PhotoPicker = (await import("../src/components/PhotoPicker.vue")).default;

const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};
const jpeg = (name = "a.jpg") => new File([new Uint8Array(4)], name, { type: "image/jpeg" });
const buttons = (root: FakeElement) => root.findAll((el) => el.tagName === "BUTTON");
const byLabel = (root: FakeElement, label: string) =>
  buttons(root).find((b) => b.getAttribute("aria-label") === label || b.textContent.trim() === label);

// v-model をつないだ親。disabled と variant を外から替えられる
const host = (initial: File | null, opts: { variant?: "letter" | "button"; disabled?: boolean } = {}) => {
  const photo = ref<File | null>(initial);
  const disabled = ref(opts.disabled ?? false);
  const pickingEvents: boolean[] = [];
  const Host = defineComponent({
    setup() {
      return () =>
        h(PhotoPicker, {
          modelValue: photo.value,
          "onUpdate:modelValue": (v: File | null) => (photo.value = v),
          onPicking: (v: boolean) => pickingEvents.push(v),
          variant: opts.variant,
          disabled: disabled.value,
        });
    },
  });
  return { Host, photo, disabled, pickingEvents };
};

beforeEach(() => {
  resetFakeDocument();
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
  pickPhoto.mockReset();
  tap.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("「はずす」のあとのフォーカス（見直し n=9 / 16）", () => {
  for (const variant of ["letter", "button"] as const) {
    it(`${variant}: キーボードや読み上げで押すと、同じ場所の「写真を添える」へフォーカスが戻る`, async () => {
      const { Host, photo } = host(jpeg(), { variant });
      const { container, errors } = mount(Host);
      await settle();
      const hazusu = byLabel(container, "はずす")!;
      hazusu.focus();
      hazusu.click(0);
      await settle();
      expect(photo.value).toBeNull();
      expect(byLabel(container, "はずす")).toBeUndefined();
      const add = byLabel(container, "写真を添える")!;
      expect(fakeDocument.activeElement).toBe(add);
      expect(errors).toEqual([]);
    });
  }

  it("指で押したときはフォーカスを動かさない（wireframes 6 節）", async () => {
    const { Host, photo } = host(jpeg(), { variant: "letter" });
    const { container } = mount(Host);
    await settle();
    byLabel(container, "はずす")!.click(1);
    await settle();
    expect(photo.value).toBeNull();
    expect(fakeDocument.activeElement).toBe(fakeDocument.body);
  });
});

describe("写真を開いている間（見直し n=14）", () => {
  it("届くまで「写真を開いています」を出して押せなくし、二度目は呼ばない。届いたら添えて戻す", async () => {
    let resolve!: (v: PickedPhoto | null) => void;
    pickPhoto.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { Host, photo, pickingEvents } = host(null, { variant: "letter" });
    const { container, errors } = mount(Host);
    await settle();
    const add = byLabel(container, "写真を添える")!;
    add.click(1);
    await settle();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("写真を開いています");
    expect(add.hasAttribute("disabled")).toBe(true);
    add.click(1); // 待てずにもう一度
    await settle();
    expect(pickPhoto).toHaveBeenCalledTimes(1);

    const f = jpeg();
    resolve({ file: f });
    await settle();
    expect(photo.value).toBe(f);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(byLabel(container, "写真を変える")!.hasAttribute("disabled")).toBe(false);
    expect(pickingEvents).toEqual([true, false]);
    expect(errors).toEqual([]);
  });

  it("やめたとき・開けなかったときも、押せる状態に戻る", async () => {
    pickPhoto.mockResolvedValueOnce(null).mockResolvedValueOnce({ error: "failed" });
    const { Host, pickingEvents } = host(null, { variant: "letter" });
    const { container } = mount(Host);
    await settle();
    byLabel(container, "写真を添える")!.click(1);
    await settle();
    expect(byLabel(container, "写真を添える")!.hasAttribute("disabled")).toBe(false);
    byLabel(container, "写真を添える")!.click(1);
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("写真を開けませんでした。もう一度押してみてください");
    expect(pickingEvents).toEqual([true, false, true, false]);
  });
});

describe("保存している間（見直し n=15）", () => {
  it("選び直しも「はずす」も押せず、添えた写真はプレビューに出したまま", async () => {
    const f = jpeg();
    const { Host, photo } = host(f, { variant: "letter", disabled: true });
    const { container } = mount(Host);
    await settle();
    const change = byLabel(container, "写真を変える")!;
    const hazusu = byLabel(container, "はずす")!;
    expect(change.hasAttribute("disabled")).toBe(true);
    expect(hazusu.hasAttribute("disabled")).toBe(true);
    change.click(1);
    hazusu.click(1);
    await settle();
    expect(pickPhoto).not.toHaveBeenCalled();
    expect(photo.value).toBe(f);
    expect(container.findAll((el) => el.tagName === "IMG")).toHaveLength(1);
  });
});

describe("S1 の便箋の下の段（letter）", () => {
  it("カメラの絵と「写真」。読み上げの名前は「写真を添える」（見える文字を名前の頭に含む）", async () => {
    const { Host } = host(null, { variant: "letter" });
    const { container } = mount(Host);
    await settle();
    const add = byLabel(container, "写真を添える")!;
    expect(add.textContent.trim()).toBe("写真");
    expect(add.findAll((el) => el.tagName === "SVG")).toHaveLength(1);
  });

  it("添えた写真は焼き付けのプリント（白いふち）で出し、押すと軽い触覚", async () => {
    pickPhoto.mockResolvedValueOnce({ file: jpeg() });
    const { Host } = host(null, { variant: "letter" });
    const { container } = mount(Host);
    await settle();
    byLabel(container, "写真を添える")!.click(1);
    await settle();
    const print = container.findAll((el) => el.hasClass("photo-print"));
    expect(print).toHaveLength(1);
    expect(print[0]!.querySelector("img")?.getAttribute("alt")).toBe("添えた写真");
    expect(tap).toHaveBeenCalledTimes(1);
  });
});
