// 触覚（haptics.ts）。select() が iPhone で一度も鳴らなかった件の再発を防ぐ。
// 原因は @capacitor/haptics 8.0.2 の iOS の実装で、selectionChanged は selectionStart で作る
// UISelectionFeedbackGenerator が無いと何もしない（Haptics.swift の `if let generator = ...`）のに、
// select() が selectionChanged だけを呼んでいたこと。Promise は成功で終わるので、失敗としても見えなかった。
import { beforeEach, describe, expect, it, vi } from "vitest";

// iOS のプラグイン（HapticsPlugin.swift / Haptics.swift）をなぞる偽物:
// - どのメソッドも、仕事を main queue（ここでは mainQueue の配列。先に積んだものから動く）に積んで、すぐ resolve する
// - selectionChanged は、selectionStart で作った generator が無ければ何もしない。selectionEnd は generator を捨てる
// - impact と notification は、呼ぶたびに generator を作って鳴らす
// vi.fn の中で投げると、vitest 5 は捕まえた後でもテストを落とすので、ふつうの関数で書く
let native = true;
let mainQueue: Array<() => void> = [];
let generator = false;
let felt: string[] = [];
let calls: string[] = [];
let startFails = false;

vi.mock("@capacitor/haptics", () => ({
  Haptics: {
    impact: async ({ style }: { style: string }) => {
      calls.push(`impact:${style}`);
      mainQueue.push(() => felt.push(`impact:${style}`));
    },
    notification: async ({ type }: { type: string }) => {
      calls.push(`notification:${type}`);
      mainQueue.push(() => felt.push(`notification:${type}`));
    },
    selectionStart: async () => {
      calls.push("selectionStart");
      if (startFails) throw new Error("plugin is not implemented");
      mainQueue.push(() => {
        generator = true;
      });
    },
    selectionChanged: async () => {
      calls.push("selectionChanged");
      mainQueue.push(() => {
        if (generator) felt.push("selection");
      });
    },
    selectionEnd: async () => {
      calls.push("selectionEnd");
      mainQueue.push(() => {
        generator = false;
      });
    },
  },
  ImpactStyle: { Heavy: "HEAVY", Medium: "MEDIUM", Light: "LIGHT" },
  NotificationType: { Success: "SUCCESS", Warning: "WARNING", Error: "ERROR" },
}));
vi.mock("../src/native", () => ({ isNative: () => native }));

const { Haptics } = await import("@capacitor/haptics");
const haptics = await import("../src/haptics");

// JS 側の Promise をすべて進めてから、main queue に積まれた仕事を順に動かす
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  while (mainQueue.length > 0) mainQueue.shift()?.();
};

beforeEach(() => {
  native = true;
  mainQueue = [];
  generator = false;
  felt = [];
  calls = [];
  startFails = false;
});

describe("iOS のプラグインの偽物", () => {
  it("selectionStart の前の selectionChanged は鳴らない（Promise は成功で終わる）", async () => {
    await expect(Haptics.selectionChanged()).resolves.toBeUndefined();
    await settle();
    expect(felt).toEqual([]);
  });
});

describe("select（選ぶものを切り替えたとき）", () => {
  it("アプリを開いて初めての 1 回目から鳴り、押すたびに鳴る", async () => {
    haptics.select();
    await settle();
    expect(felt).toEqual(["selection"]);

    haptics.select();
    await settle();
    expect(felt).toEqual(["selection", "selection"]);
  });

  it("selectionStart が済んでから selectionChanged を呼ぶ（selectionEnd は呼ばない）", async () => {
    haptics.select();
    await settle();
    expect(calls).toEqual(["selectionStart", "selectionChanged"]);
  });

  it("selectionStart が失敗しても投げず、selectionChanged も呼ばない", async () => {
    startFails = true;
    expect(() => haptics.select()).not.toThrow();
    await settle();
    expect(calls).toEqual(["selectionStart"]);
    expect(felt).toEqual([]);
  });

  it("Web（ブラウザでの開発）では何もしない", async () => {
    native = false;
    haptics.select();
    await settle();
    expect(calls).toEqual([]);
  });
});

describe("ほかの触覚", () => {
  it("tap / stamp / saved / arrive / failed は、呼ぶたびにそのまま鳴る", async () => {
    haptics.tap();
    haptics.stamp();
    haptics.saved();
    haptics.arrive();
    haptics.failed();
    await settle();
    expect(felt).toEqual([
      "impact:LIGHT",
      "impact:MEDIUM",
      "notification:SUCCESS",
      "impact:LIGHT",
      "notification:WARNING",
    ]);
  });

  it("Web（ブラウザでの開発）では何もしない", async () => {
    native = false;
    haptics.tap();
    haptics.stamp();
    haptics.saved();
    haptics.arrive();
    haptics.failed();
    await settle();
    expect(calls).toEqual([]);
  });
});
