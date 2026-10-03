/**
 * IPFS pinning service: pins JSON to IPFS via Pinata using a server-side secret.
 * Keeps PINATA_JWT out of the browser bundle. Workers-compatible (fetch only).
 */
import { log } from "../lib/logger.js";
import { getEnv } from "../config/env.js";

const L = log.ipfs;
const PINATA_PIN_JSON_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
export const MAX_PIN_BYTES = 256 * 1024;

/** Raised when pinning is not configured on the server (maps to 503). */
export class PinningNotConfiguredError extends Error {}
/** Raised when the JSON payload exceeds MAX_PIN_BYTES (maps to 413). */
export class PinPayloadTooLargeError extends Error {}
/** Raised when Pinata rejects or fails the request (maps to 502). */
export class PinUpstreamError extends Error {}

function gatewayBase(): string {
  const base = getEnv().PINATA_GATEWAY;
  return base.endsWith("/") ? base : `${base}/`;
}

export async function pinJson(content: unknown, name?: string): Promise<{ cid: string; url: string }> {
  const jwt = getEnv().PINATA_JWT;
  if (!jwt) throw new PinningNotConfiguredError("PINATA_JWT is not set on the server; IPFS pinning is unavailable");

  const size = new TextEncoder().encode(JSON.stringify(content)).byteLength;
  if (size > MAX_PIN_BYTES) {
    throw new PinPayloadTooLargeError(`JSON payload is ${size} bytes; limit is ${MAX_PIN_BYTES} bytes`);
  }

  let res: Response;
  try {
    res = await fetch(PINATA_PIN_JSON_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        pinataContent: content,
        pinataMetadata: { name: name || `cloudana-${Date.now()}`, keyvalues: { network: "cloudana" } },
        pinataOptions: { cidVersion: 1 },
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new PinUpstreamError(`Pinata request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    L.error(`Pinata pin failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    throw new PinUpstreamError(`Pinata returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as { IpfsHash?: string };
  if (!data.IpfsHash) throw new PinUpstreamError("Pinata response missing IpfsHash");
  return { cid: data.IpfsHash, url: `${gatewayBase()}${data.IpfsHash}` };
}
