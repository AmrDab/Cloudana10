import { describe, expect, it } from "vitest";
import { sectionFor } from "./anchors";

describe("sectionFor", () => {
  it("resolves section ids", () => {
    expect(sectionFor("#cld")).toBe("cld");
    expect(sectionFor("verify")).toBe("verify");
  });

  it("maps the old homepage anchors the lab still links to", () => {
    expect(sectionFor("#services")).toBe("run");
    expect(sectionFor("#pays")).toBe("cld");
    expect(sectionFor("#provide")).toBe("provide");
    expect(sectionFor("#status")).toBe("network");
    expect(sectionFor("#waitlist")).toBe("waitlist");
  });

  it("ignores empty, unknown and malformed hashes", () => {
    expect(sectionFor("")).toBeNull();
    expect(sectionFor("#")).toBeNull();
    expect(sectionFor("#nope")).toBeNull();
    expect(sectionFor("#%E0%A4%A")).toBeNull();
  });
});
