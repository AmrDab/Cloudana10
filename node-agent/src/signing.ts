import { createHash, randomBytes } from "node:crypto";
import type { PrivateKeyAccount } from "viem";

export function sha256hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface SignedHeaders {
  "X-Node": string;
  "X-Node-Timestamp": string;
  "X-Nonce": string;
  "X-Node-Signature": string;
}

/**
 * Offset (ms) added to the local clock so timestamps land inside the API's ±60 s window even when this
 * machine's clock is off. Set from the server's Date header (serverTimeOffset) — never fatal.
 */
let clockOffsetMs = 0;
export const clockOffset = () => clockOffsetMs;
export const serverNow = () => Date.now() + clockOffsetMs;

/** Learn the offset from a response's Date header (second resolution). Returns the new offset. */
export function learnClockOffset(dateHeader: string | null, localNow = Date.now()): number {
  const server = dateHeader ? Date.parse(dateHeader) : NaN;
  if (Number.isFinite(server)) clockOffsetMs = server - localNow;
  return clockOffsetMs;
}

/**
 * Sign a request per the spec: message = "<METHOD> <path> <timestampMs> <sha256hex(body)> <nonce>",
 * signed with the node key via personal_sign (viem's signMessage). The nonce (16 random bytes, hex)
 * makes every request single-use at the API.
 */
export async function signRequest(
  account: PrivateKeyAccount,
  method: string,
  path: string,
  bodyStr: string,
): Promise<SignedHeaders> {
  const timestamp = serverNow();
  const nonce = randomBytes(16).toString("hex");
  const message = `${method} ${path} ${timestamp} ${sha256hex(bodyStr)} ${nonce}`;
  const signature = await account.signMessage({ message });
  return {
    "X-Node": account.address,
    "X-Node-Timestamp": String(timestamp),
    "X-Nonce": nonce,
    "X-Node-Signature": signature,
  };
}
