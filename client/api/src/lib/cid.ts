/**
 * Decode contract bytes (0x hex) to CID string for IPFS gateway URLs.
 */
import { CID } from "multiformats/cid";
import { hexToBytes } from "viem";

export function bytesToCidString(bytes: `0x${string}` | Uint8Array): string {
  const u8 = typeof bytes === "string" ? hexToBytes(bytes) : bytes;
  const cid = CID.decode(u8);
  return cid.toString();
}
