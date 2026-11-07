// ネイティブの設定（native.ts の setupNative）。鍵盤の出入りを keyboard.ts に知らせること（見直し n=10）と、
// 付属バーの「完了」を戻すこと（@capacitor/keyboard は読み込みで付属バーを消す）を確かめる。
import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (info?: { keyboardHeight: number }) => void;
let native = true;
let listeners = new Map<string, Listener>();
let accessoryBar: boolean[] = [];
let styles: string[] = [];
let accessoryFails = false;

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => native, getPlatform: () => (native ? "ios" : "web") },
}));
vi.mock("@capacitor/keyboard", () => ({
  Keyboard: {
    addListener: async (name: string, fn: Listener) => {
      listeners.set(name, fn);
      return { remove: async () => {} };
    },
    setAccessoryBarVisible: async ({ isVisible }: { isVisible: boolean }) => {
      if (accessoryFails) throw new Error("not implemented on android");
      accessoryBar.push(isVisible);
    },
  },
}));
vi.mock("@capacitor/status-bar", () => ({
  StatusBar: {
    setStyle: async ({ style }: { style: string }) => {
      styles.push(style);
    },
  },
  Style: { Light: "LIGHT", Dark: "DARK" },
}));
vi.mock("@capacitor/splash-screen", () => ({ SplashScreen: { hide: async () => {} } }));

// keyboard.ts が <html> に付ける印を受ける最小の documentElement（createElement は vue の runtime-dom が読み込みで呼ぶ）
const attrs = new Map<string, string>();
const props = new Map<string, string>();
vi.stubGlobal("document", {
  createElement: () => ({}),
  documentElement: {
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
    style: { setProperty: (k: string, v: string) => props.set(k, v) },
  },
});

const { setupNative } = await import("../src/native");
const { setKeyboard, useKeyboard } = await import("../src/keyboard");

const fire = (name: string, info?: { keyboardHeight: number }) => {
  const fn = listeners.get(name);
  if (!fn) throw new Error(`${name} が登録されていない`);
  fn(info);
};

beforeEach(() => {
  native = true;
  listeners = new Map();
  accessoryBar = [];
  styles = [];
  accessoryFails = false;
  setKeyboard(false, 0);
  attrs.clear();
  props.clear();
});

describe("setupNative の鍵盤", () => {
  it("鍵盤が出ると <html data-keyboard=open> と --keyboard-height、閉じると外して 0px", async () => {
    await setupNative();
    const { open, height } = useKeyboard();

    fire("keyboardWillShow", { keyboardHeight: 336 });
    expect(attrs.get("data-keyboard")).toBe("open");
    expect(props.get("--keyboard-height")).toBe("336px");
    expect(open.value).toBe(true);
    expect(height.value).toBe(336);

    // 鍵盤の種類を変えて高さが変わったときも追う（かな → 絵文字）
    fire("keyboardWillShow", { keyboardHeight: 301.5 });
    expect(props.get("--keyboard-height")).toBe("302px");

    fire("keyboardWillHide");
    expect(attrs.has("data-keyboard")).toBe(false);
    expect(props.get("--keyboard-height")).toBe("0px");
    expect(open.value).toBe(false);
    expect(height.value).toBe(0);
  });

  it("高さ 0 の「出る」（外付けの鍵盤で予測の帯だけ）は閉じている扱いにして、下部ナビを隠さない", async () => {
    await setupNative();
    fire("keyboardWillShow", { keyboardHeight: 0 });
    expect(attrs.has("data-keyboard")).toBe(false);
    expect(useKeyboard().open.value).toBe(false);
  });

  it("付属バーの「完了」を出す（textarea の改行のキーでは鍵盤を閉じられない）", async () => {
    await setupNative();
    expect(accessoryBar).toEqual([true]);
  });

  it("付属バーが使えない環境（Android）でも、鍵盤の出入りは受ける", async () => {
    accessoryFails = true;
    await setupNative();
    expect(listeners.has("keyboardWillShow")).toBe(true);
    expect(listeners.has("keyboardWillHide")).toBe(true);
  });

  it("ステータスバーは明るい地に濃い文字", async () => {
    await setupNative();
    expect(styles).toEqual(["LIGHT"]);
  });

  it("Web（ブラウザでの開発）では何もしない", async () => {
    native = false;
    await setupNative();
    expect(listeners.size).toBe(0);
    expect(accessoryBar).toEqual([]);
    expect(styles).toEqual([]);
  });
});
