import { describe, it, expect } from "vitest";
import { validateProviderEndpoint } from "../src/services/hardware-scan.service.js";

describe("validateProviderEndpoint", () => {
  it("rejects ftp://", () => {
    expect(validateProviderEndpoint("ftp://example.com").ok).toBe(false);
  });

  it("rejects credentials in URL", () => {
    expect(validateProviderEndpoint("http://user:pass@example.com").ok).toBe(false);
  });

  it("rejects localhost", () => {
    expect(validateProviderEndpoint("http://localhost:4040").ok).toBe(false);
  });

  it("rejects *.localhost", () => {
    expect(validateProviderEndpoint("http://foo.localhost").ok).toBe(false);
  });

  it("rejects *.local", () => {
    expect(validateProviderEndpoint("http://foo.local").ok).toBe(false);
  });

  it("rejects *.internal", () => {
    expect(validateProviderEndpoint("http://foo.internal").ok).toBe(false);
  });

  it("rejects 127.0.0.1", () => {
    expect(validateProviderEndpoint("http://127.0.0.1").ok).toBe(false);
  });

  it("rejects 10.x", () => {
    expect(validateProviderEndpoint("http://10.1.2.3").ok).toBe(false);
  });

  it("rejects 172.16-31.x", () => {
    expect(validateProviderEndpoint("http://172.16.0.1").ok).toBe(false);
    expect(validateProviderEndpoint("http://172.31.0.1").ok).toBe(false);
    expect(validateProviderEndpoint("http://172.15.0.1").ok).toBe(true);
    expect(validateProviderEndpoint("http://172.32.0.1").ok).toBe(true);
  });

  it("rejects 192.168.x", () => {
    expect(validateProviderEndpoint("http://192.168.1.1").ok).toBe(false);
  });

  it("rejects 169.254.x", () => {
    expect(validateProviderEndpoint("http://169.254.1.1").ok).toBe(false);
  });

  it("rejects 100.64.x", () => {
    expect(validateProviderEndpoint("http://100.64.0.1").ok).toBe(false);
  });

  it("rejects 0.x", () => {
    expect(validateProviderEndpoint("http://0.0.0.0").ok).toBe(false);
  });

  it("rejects 224+ (multicast/reserved)", () => {
    expect(validateProviderEndpoint("http://224.0.0.1").ok).toBe(false);
    expect(validateProviderEndpoint("http://240.0.0.1").ok).toBe(false);
  });

  it("rejects ::1", () => {
    expect(validateProviderEndpoint("http://[::1]").ok).toBe(false);
  });

  it("rejects fc00::", () => {
    expect(validateProviderEndpoint("http://[fc00::1]").ok).toBe(false);
  });

  it("rejects fe80::", () => {
    expect(validateProviderEndpoint("http://[fe80::1]").ok).toBe(false);
  });

  it("rejects ::ffff: (v4-mapped)", () => {
    expect(validateProviderEndpoint("http://[::ffff:127.0.0.1]").ok).toBe(false);
  });

  it("accepts a public http endpoint with port", () => {
    const result = validateProviderEndpoint("http://203.0.113.5:4040");
    expect(result).toEqual({ ok: true, url: "http://203.0.113.5:4040/" });
  });

  it("accepts a public https hostname", () => {
    const result = validateProviderEndpoint("https://node.example.com");
    expect(result.ok).toBe(true);
  });

  it("strips trailing slash, query, and hash", () => {
    const result = validateProviderEndpoint("https://node.example.com/path/?q=1#frag");
    expect(result).toEqual({ ok: true, url: "https://node.example.com/path" });
  });
});
