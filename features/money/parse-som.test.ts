import { describe, expect, it } from "vitest";

import { parseSomToTyiyn } from "./parse-som";

describe("parseSomToTyiyn", () => {
  it("parses whole som and two decimal digits without floating point arithmetic", () => {
    expect(parseSomToTyiyn("250")).toBe(25_000);
    expect(parseSomToTyiyn("40,5")).toBe(4_050);
    expect(parseSomToTyiyn("1 234.56")).toBe(123_456);
  });

  it("rejects negative, malformed, and too-large price strings", () => {
    expect(parseSomToTyiyn("-1")).toBeNull();
    expect(parseSomToTyiyn("20.999")).toBeNull();
    expect(parseSomToTyiyn("abc")).toBeNull();
    expect(parseSomToTyiyn("999999999999999999")).toBeNull();
  });
});
