// iPhone の土台（ADR-0011）の約束を見張る: Capacitor の設定、鍵盤が出ている間に下部ナビを隠す CSS と BottomNav の名前、
// 入力欄の文字の大きさ（16px 未満だと iOS が入力欄に寄って拡大する）、Info.plist。
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../../capacitor.config";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("capacitor.config.ts", () => {
  it("鍵盤は native（WKWebView の枠を縮め、書いている行を鍵盤の上に送れるまま）、明るい鍵盤、窓の地は紙の色", () => {
    expect(config.plugins?.Keyboard).toEqual({ resize: "native", style: "LIGHT", autoBackdropColor: "auto" });
    expect(config.backgroundColor).toBe("#FAF5EC");
  });

  it("iOS は長押しでリンクの下見を出さず、セーフエリアは CSS の env() だけで取る", () => {
    expect(config.ios?.allowsLinkPreview).toBe(false);
    expect(config.ios?.contentInset).toBe("never"); // wireframes 第8節 #23
  });
});

describe("鍵盤が出ている間は下部ナビを隠す（見直し n=10）", () => {
  it("platform.css の対象と BottomNav.vue の <nav> の aria-label が同じ", () => {
    const css = read("web/src/styles/platform.css");
    const m = css.match(/html\[data-keyboard="open"\] nav\[aria-label="([^"]+)"\]\s*\{\s*display:\s*none;\s*\}/);
    expect(m).not.toBeNull();
    const nav = read("web/src/components/BottomNav.vue");
    expect(nav).toContain(`aria-label="${m?.[1]}"`);
  });

  it("platform.css は --keyboard-height で余白を足さない（native では枠がもう鍵盤のぶん縮んでいる）", () => {
    const css = read("web/src/styles/platform.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toContain("--keyboard-height");
  });
});

describe("iPhone の手ざわり", () => {
  it("本文の文字は選べるまま（user-select: none は押すもの・絵・写真だけ。html / body / p / label には付けない）", () => {
    const css = read("web/src/styles/platform.css").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/user-select:\s*none/.test(block[2] ?? "")) continue;
      const selectors = (block[1] ?? "").split(",").map((s) => s.trim());
      expect(selectors).not.toContain("html");
      expect(selectors).not.toContain("body");
      expect(selectors).not.toContain("p");
      expect(selectors).not.toContain("label");
      expect(selectors).not.toContain("*");
    }
  });

  it("入力欄の文字は 16px 以上（text-xs / text-sm / 16px 未満の指定を付けない）", () => {
    const vueFiles = (dir: string): string[] =>
      readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? vueFiles(join(dir, e.name)) : e.name.endsWith(".vue") ? [join(dir, e.name)] : [],
      );
    const small = /(^|\s)text-(xs|sm|\[(1[0-5]|[0-9])px\])(\s|$)/;
    const found: string[] = [];
    for (const f of vueFiles("web/src")) {
      for (const tag of read(f).matchAll(/<(input|textarea|select)\b[^>]*>/g)) {
        const cls = tag[0].match(/\sclass="([^"]*)"/)?.[1] ?? "";
        if (small.test(cls)) found.push(`${f}: ${tag[0].slice(0, 80)}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("index.html: 拡大しないページ（ダブルタップで寄らない）、明るい表示だけ、数字を電話のリンクにしない", () => {
    const html = read("web/index.html");
    // WKWebView は拡大できる viewport のままだとダブルタップで拡大する（touch-action: manipulation では実機で止まらなかった。ADR-0011 の 5 節）
    const viewport = (html.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? "").split(/\s*,\s*/);
    expect(viewport).toEqual(
      expect.arrayContaining(["width=device-width", "initial-scale=1", "maximum-scale=1", "user-scalable=no", "viewport-fit=cover"]),
    );
    expect(html).toContain('<meta name="color-scheme" content="light" />');
    expect(html).toMatch(/<meta name="format-detection" content="telephone=no/);
  });
});

describe("アプリのアイコン（AppIcon.appiconset）", () => {
  const DIR = "ios/App/App/Assets.xcassets/AppIcon.appiconset";
  type Image = { filename?: string; size?: string; appearances?: { appearance: string; value: string }[] };
  const images = (JSON.parse(read(`${DIR}/Contents.json`)) as { images: Image[] }).images;
  // PNG の IHDR: 幅（16..20）、高さ（20..24）、色の型（25。2 = RGB、6 = RGBA）
  const ihdr = (file: string) => {
    const b = readFileSync(join(ROOT, DIR, file));
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
  };

  it("ふだんのアイコンは 1024×1024 の不透明な PNG（透明があると App Store に断られる）", () => {
    const base = images.filter((i) => !i.appearances);
    expect(base).toHaveLength(1);
    expect(base[0]?.size).toBe("1024x1024");
    expect(ihdr(base[0]?.filename ?? "")).toEqual({ width: 1024, height: 1024, colorType: 2 });
  });

  it("暗い表示と色付きの表示（iOS 18 以降）も 1024×1024 で、書いたファイルがある", () => {
    for (const value of ["dark", "tinted"]) {
      const img = images.find((i) => i.appearances?.some((a) => a.appearance === "luminosity" && a.value === value));
      expect(img?.size).toBe("1024x1024");
      const { width, height } = ihdr(img?.filename ?? "");
      expect([width, height]).toEqual([1024, 1024]);
    }
  });
});

describe("Info.plist（iPhone）", () => {
  const plist = read("ios/App/App/Info.plist");
  const arrayOf = (key: string) =>
    [...(plist.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`))?.[1] ?? "").matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]);

  it("明るい表示に固定（鍵盤・日付の選択・写真の選択の画面も紙に合わせる）、起動中のステータスバーは濃い文字", () => {
    expect(plist).toMatch(/<key>UIUserInterfaceStyle<\/key>\s*<string>Light<\/string>/);
    expect(plist).toMatch(/<key>UIStatusBarStyle<\/key>\s*<string>UIStatusBarStyleDarkContent<\/string>/);
  });

  it("iPhone は縦だけ", () => {
    expect(arrayOf("UISupportedInterfaceOrientations")).toEqual(["UIInterfaceOrientationPortrait"]);
  });
});
