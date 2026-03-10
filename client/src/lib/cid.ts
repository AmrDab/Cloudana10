/**
 * Encode/decode IPFS CID to/from binary bytes for on-chain storage.
 * Contract stores manifestCID as `bytes` (multicodec binary form); we convert to/from string for IPFS URLs.
 */
import { CID } from "multiformats/cid";
import { bytesToHex, hexToBytes } from "viem";

/** Encode a CID string (e.g. "bafybei...") to contract ABI bytes (0x-prefixed hex). */
export function cidStringToBytes(cidStr: string): `0x${string}` {
  const cid = CID.parse(cidStr);
  return bytesToHex(cid.bytes) as `0x${string}`;
}

/** Decode contract bytes (0x hex or Uint8Array) to CID string for IPFS gateway URLs. */
export function bytesToCidString(bytes: `0x${string}` | Uint8Array): string {
  const u8 = typeof bytes === "string" ? hexToBytes(bytes) : bytes;
  const cid = CID.decode(u8);
  return cid.toString();
}
