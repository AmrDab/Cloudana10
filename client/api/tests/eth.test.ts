import { describe, it, expect } from "vitest";
import { isAddress, normalizeAddress } from "../src/lib/eth.js";

const VALID = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

describe("isAddress", () => {
  it("accepts a valid 0x address", () => {
    expect(isAddress(VALID)).toBe(true);
  });

  it("accepts a valid lowercase 0x address", () => {
    expect(isAddress(VALID.toLowerCase())).toBe(true);
  });

  it("rejects a short address", () => {
    expect(isAddress("0x123")).toBe(false);
  });

  it("rejects a long address", () => {
    expect(isAddress(VALID + "00")).toBe(false);
  });

  it("rejects a non-hex address", () => {
    expect(isAddress("0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isAddress(undefined)).toBe(false);
  });
});

describe("normalizeAddress", () => {
  it("lowercases and trims", () => {
    expect(normalizeAddress(`  ${VALID}  `)).toBe(VALID.toLowerCase());
  });
});
