import { newCode, normalizeCode, showCode } from "./code.ts";

describe("cloud codes", () => {
  it("makes 16 characters of Crockford base32 from random bytes", () => {
    const code = newCode((n) => Uint8Array.from({ length: n }, (_, i) => i * 37));
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(newCode((n) => new Uint8Array(n).fill(255))).toBe("ZZZZZZZZZZZZZZZZ");
  });

  it("reads what a player typed, forgivingly", () => {
    expect(normalizeCode("7kqf-m2xd-9hpa-t4wn")).toBe("7KQFM2XD9HPAT4WN");
    expect(normalizeCode(" 7KQF M2XD 9HPA T4WN ")).toBe("7KQFM2XD9HPAT4WN");
    expect(normalizeCode("OIL0-0000-0000-0000")).toBe("0110000000000000");
  });

  it("refuses what isn't a code", () => {
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode("7KQF-M2XD-9HPA-T4W")).toBeNull();
    expect(normalizeCode("7KQF-M2XD-9HPA-T4WNX")).toBeNull();
    expect(normalizeCode("UUUU-UUUU-UUUU-UUUU")).toBeNull();
  });

  it("shows a code in groups of four", () => {
    expect(showCode("7KQFM2XD9HPAT4WN")).toBe("7KQF-M2XD-9HPA-T4WN");
  });
});
