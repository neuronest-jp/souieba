// 写真の表示（PhotoImg）。読み込みに一度失敗しても、画面に戻ったとき（KeepAlive の activated）と通信が戻ったときに取り直す。
// S2 の 56px の焼き付け（quiet）では失敗の文言を出さず、読み込み中と同じ空の枠にする（見直し n=12）。
// 読めた写真は焼き付けがふわっと出る（load までは .photo-develop だけ、読めたら is-shown）。DOM は web/test/fakeDom.ts の最小のもの
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, KeepAlive, nextTick, ref } from "vue";
import { fakeDocument, mount, resetFakeDocument, type FakeElement } from "./fakeDom";

const photos = vi.hoisted(() => ({
  fetchPhotoObjectUrl: vi.fn<(key: string) => Promise<string>>(),
  releasePhotoObjectUrl: vi.fn<(key: string) => void>(),
}));
vi.mock("../src/photos", () => photos);

const PhotoImg = (await import("../src/components/PhotoImg.vue")).default;

const settle = async () => {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();
  }
};
const imgs = (root: FakeElement) => root.findAll((el) => el.tagName === "IMG");
let onWindow: Record<string, () => void> = {};

beforeEach(() => {
  resetFakeDocument();
  vi.stubGlobal("document", fakeDocument);
  onWindow = {};
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: () => void) => void (onWindow[type] = fn),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
  photos.fetchPhotoObjectUrl.mockReset();
  photos.releasePhotoObjectUrl.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("読み込みに失敗したとき（見直し n=12）", () => {
  it("quiet（S2 の小さな焼き付け）では文言を出さず、読み込み中と同じ空の枠（読み上げから隠す）にする", async () => {
    photos.fetchPhotoObjectUrl.mockRejectedValue(new Error("offline"));
    const { container, errors } = mount(PhotoImg, { photoKey: "u/1.jpg", quiet: true, class: "size-full" });
    await settle();
    expect(container.textContent).not.toContain("写真を読めませんでした");
    const box = container.children[0]!;
    expect(box.getAttribute("aria-hidden")).toBe("true");
    expect(box.hasClass("size-full")).toBe(true);
    expect(errors).toEqual([]);
  });

  it("quiet でなければ、これまでどおり「写真を読めませんでした」を出す", async () => {
    photos.fetchPhotoObjectUrl.mockRejectedValue(new Error("offline"));
    const { container } = mount(PhotoImg, { photoKey: "u/1.jpg", boxClass: "h-[120px] w-full" });
    await settle();
    expect(container.textContent).toContain("写真を読めませんでした");
  });

  it("KeepAlive で残した画面に戻ったら取り直す。失敗した鍵は手放さない（同じ鍵を持つほかの写真の参照数を減らさない）", async () => {
    photos.fetchPhotoObjectUrl.mockRejectedValueOnce(new Error("offline")).mockResolvedValue("blob:ok");
    const shown = ref<"photo" | "other">("photo");
    const Holder = defineComponent({ name: "Holder", setup: () => () => h(PhotoImg, { photoKey: "u/1.jpg", quiet: true }) });
    const Other = defineComponent({ name: "Other", setup: () => () => h("p", "other") });
    const App = defineComponent({ setup: () => () => h(KeepAlive, null, [shown.value === "photo" ? h(Holder) : h(Other)]) });
    const { container, errors } = mount(App);
    await settle();
    expect(imgs(container)).toEqual([]);
    expect(photos.fetchPhotoObjectUrl).toHaveBeenCalledTimes(1);
    shown.value = "other";
    await settle();
    shown.value = "photo";
    await settle();
    expect(photos.fetchPhotoObjectUrl).toHaveBeenCalledTimes(2);
    expect(imgs(container).map((el) => el.getAttribute("src"))).toEqual(["blob:ok"]);
    expect(photos.releasePhotoObjectUrl).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it("通信が戻ったら（online）取り直す。読めている写真は取り直さない", async () => {
    photos.fetchPhotoObjectUrl.mockRejectedValueOnce(new Error("offline")).mockResolvedValue("blob:ok");
    const { container } = mount(PhotoImg, { photoKey: "u/1.jpg" });
    await settle();
    expect(container.textContent).toContain("写真を読めませんでした");
    onWindow.online?.();
    await settle();
    expect(imgs(container).map((el) => el.getAttribute("src"))).toEqual(["blob:ok"]);
    onWindow.online?.();
    await settle();
    expect(photos.fetchPhotoObjectUrl).toHaveBeenCalledTimes(2);
  });
});

describe("読めた写真", () => {
  it("焼き付けは読み込めてからふわっと出す（load までは is-shown が無い）。外したら鍵を 1 度だけ手放す", async () => {
    photos.fetchPhotoObjectUrl.mockResolvedValue("blob:ok");
    const { container, unmount } = mount(PhotoImg, { photoKey: "u/1.jpg", alt: "青梅", class: "size-full" });
    await settle();
    const img = imgs(container)[0]!;
    expect(img.getAttribute("alt")).toBe("青梅");
    expect(img.hasClass("photo-develop") && img.hasClass("size-full")).toBe(true);
    expect(img.hasClass("is-shown")).toBe(false);
    img.dispatch("load");
    await nextTick();
    expect(img.hasClass("is-shown")).toBe(true);
    unmount();
    expect(photos.releasePhotoObjectUrl.mock.calls).toEqual([["u/1.jpg"]]);
  });

  it("blob が読めなかったとき（error）は失敗の枠に替え、次に戻ったとき取り直せるようにする", async () => {
    photos.fetchPhotoObjectUrl.mockResolvedValueOnce("blob:gone").mockResolvedValue("blob:ok");
    const { container } = mount(PhotoImg, { photoKey: "u/1.jpg" });
    await settle();
    imgs(container)[0]!.dispatch("error");
    await settle();
    expect(container.textContent).toContain("写真を読めませんでした");
    expect(photos.releasePhotoObjectUrl.mock.calls).toEqual([["u/1.jpg"]]);
    onWindow.online?.();
    await settle();
    expect(imgs(container).map((el) => el.getAttribute("src"))).toEqual(["blob:ok"]);
  });
});
