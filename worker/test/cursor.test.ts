import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../src/cursor";
import { ApiError } from "../src/errors";

describe("cursor", () => {
  it("往復できる", () => {
    const c = { h: "2026-11-04", c: "2026-11-04T01:23:45.000Z", i: "9b1c" };
    const s = encodeCursor(c);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(s)).toEqual(c);
  });
  it("空は null", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });
  it("壊れたカーソルは 400", () => {
    for (const bad of ["!!!", "bm90anNvbg", encodeCursor({ h: "x" } as never), "a".repeat(600)]) {
      expect(() => decodeCursor(bad)).toThrow(ApiError);
    }
  });
});
