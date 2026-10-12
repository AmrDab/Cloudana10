import { describe, it, expect } from "vitest";
import {
  MAX_FRAME_BYTES,
  chunks,
  decodeData,
  encodeData,
  forwardableHeaders,
  parseHubMessage,
  parseNodeMessage,
} from "../../../shared/relay-protocol.js";
import { TICKET_TTL_MS, issueTicket, verifyTicket } from "../../../shared/relay-ticket.js";

describe("relay frames", () => {
  it("round-trips a body frame with its stream id", () => {
    const frame = encodeData(0xfffffffe, new Uint8Array([1, 2, 3]));
    expect(frame.byteLength).toBe(7);
    expect(decodeData(frame)).toEqual({ s: 0xfffffffe, data: new Uint8Array([1, 2, 3]) });
    expect(decodeData(frame.buffer)).toEqual({ s: 0xfffffffe, data: new Uint8Array([1, 2, 3]) });
  });

  it("refuses oversized payloads, stream 0 and short frames", () => {
    expect(() => encodeData(1, new Uint8Array(MAX_FRAME_BYTES + 1))).toThrow(RangeError);
    expect(() => encodeData(0, new Uint8Array(1))).toThrow(RangeError);
    expect(decodeData(new Uint8Array(3))).toBeNull();
    expect(decodeData(new Uint8Array([0, 0, 0, 0, 9]))).toBeNull();
    expect(decodeData(new Uint8Array(4 + MAX_FRAME_BYTES + 1))).toBeNull();
  });

  it("cuts large bodies into ≤ 64 KiB payloads", () => {
    const sizes = [...chunks(new Uint8Array(MAX_FRAME_BYTES * 2 + 10))].map((c) => c.byteLength);
    expect(sizes).toEqual([MAX_FRAME_BYTES, MAX_FRAME_BYTES, 10]);
    expect([...chunks(new Uint8Array(0))]).toEqual([]);
  });
});

describe("relay control messages", () => {
  it("accepts well-formed messages each way", () => {
    expect(parseHubMessage(JSON.stringify({ t: "req", s: 1, dep: "abc-1", m: "POST", path: "/v1/x?q=1", h: [["content-type", "application/json"]] }))).toEqual({
      t: "req", s: 1, dep: "abc-1", m: "POST", path: "/v1/x?q=1", h: [["content-type", "application/json"]],
    });
    expect(parseHubMessage('{"t":"ack","s":2,"n":4096}')).toEqual({ t: "ack", s: 2, n: 4096 });
    expect(parseNodeMessage('{"t":"res","s":3,"status":200,"h":[]}')).toEqual({ t: "res", s: 3, status: 200, h: [] });
    expect(parseNodeMessage('{"t":"err","s":3,"code":"not_serving","message":"x"}')).toEqual({ t: "err", s: 3, code: "not_serving", message: "x" });
  });

  it("drops anything malformed instead of throwing", () => {
    for (const bad of [
      "not json",
      "[]",
      '{"t":"req","s":0,"dep":"a","m":"GET","path":"/","h":[]}', // stream 0
      '{"t":"req","s":1,"dep":"../x","m":"GET","path":"/","h":[]}', // dep not an id
      '{"t":"req","s":1,"dep":"a","m":"get","path":"/","h":[]}', // method not upper-case
      '{"t":"req","s":1,"dep":"a","m":"GET","path":"http://evil/","h":[]}', // absolute path
      '{"t":"req","s":1,"dep":"a","m":"GET","path":"/","h":[["a"]]}',
      '{"t":"err","s":1,"code":"boom"}',
      '{"t":"res","s":1,"status":42,"h":[]}',
      '{"t":"nope","s":1}',
    ]) {
      expect(parseHubMessage(bad) ?? parseNodeMessage(bad)).toBeNull();
    }
  });

  it("strips hop-by-hop, host, length, Cloudflare and relay-internal headers", () => {
    const out = forwardableHeaders([
      ["Content-Type", "text/plain"],
      ["Connection", "keep-alive"],
      ["Host", "x"],
      ["Content-Length", "3"],
      ["CF-Connecting-IP", "1.2.3.4"],
      ["X-Relay-Dep", "a"],
      ["Authorization", "Bearer t"],
    ]);
    expect(out).toEqual([["content-type", "text/plain"], ["authorization", "Bearer t"]]);
  });
});

describe("relay tickets", () => {
  const secret = "s".repeat(40);
  const node = "0x" + "ab".repeat(20);

  it("verifies its own ticket and returns the node", async () => {
    const now = 1_800_000_000_000;
    const { ticket, expiresAt } = await issueTicket(secret, node.toUpperCase().replace("0X", "0x"), now);
    expect(expiresAt).toBe(now + TICKET_TTL_MS);
    expect(await verifyTicket(secret, ticket, now + 1000)).toMatchObject({ node, expiresAt });
  });

  it("rejects expired, tampered, wrong-secret and malformed tickets", async () => {
    const now = 1_800_000_000_000;
    const { ticket } = await issueTicket(secret, node, now);
    expect(await verifyTicket(secret, ticket, now + TICKET_TTL_MS)).toBeNull();
    expect(await verifyTicket("t".repeat(40), ticket, now)).toBeNull();
    const other = "0x" + "cd".repeat(20);
    expect(await verifyTicket(secret, ticket.replace(node, other), now)).toBeNull();
    expect(await verifyTicket(secret, ticket.slice(0, -1) + (ticket.endsWith("0") ? "1" : "0"), now)).toBeNull();
    expect(await verifyTicket(secret, "a.b.c.d", now)).toBeNull();
  });

  it("refuses a short secret", async () => {
    await expect(issueTicket("short", node)).rejects.toThrow(/32 characters/);
  });
});
