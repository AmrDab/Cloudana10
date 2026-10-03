/**
 * Ethereum address helpers — one implementation instead of a regex per route.
 */
import { isAddress as viemIsAddress } from "viem";
import { publicKeyToAddress } from "viem/accounts";

export type HexAddress = `0x${string}`;

/** True for a well-formed 20-byte hex address (checksum not enforced). */
export function isAddress(value: unknown): value is HexAddress {
  return typeof value === "string" && viemIsAddress(value, { strict: false });
}

/** Lowercase canonical form used as a storage/identity key. */
export function normalizeAddress(value: string): HexAddress {
  return value.trim().toLowerCase() as HexAddress;
}

/** True when an uncompressed secp256k1 public key ("04…", with or without 0x) belongs to `address`. */
export function pubkeyMatchesAddress(pubkey: string, address: string): boolean {
  try {
    const hex = (pubkey.startsWith("0x") ? pubkey : `0x${pubkey}`) as `0x${string}`;
    return publicKeyToAddress(hex).toLowerCase() === normalizeAddress(address);
  } catch {
    return false;
  }
}
