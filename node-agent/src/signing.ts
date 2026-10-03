import { createHash } from "node:crypto";
import type { PrivateKeyAccount } from "viem";

export function sha256hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface SignedHeaders {
  "X-Node": string;
  "X-Node-Timestamp": string;
  "X-Node-Signature": string;
}

/**
 * Sign a request per the spec: message = "<METHOD> <path> <timestampMs> <sha256hex(body)>",
 * signed with the node key via personal_sign (viem's signMessage).
 */
export async function signRequest(
  account: PrivateKeyAccount,
  method: string,
  path: string,
  bodyStr: string,
): Promise<SignedHeaders> {
  const timestamp = Date.now();
  const message = `${method} ${path} ${timestamp} ${sha256hex(bodyStr)}`;
  const signature = await account.signMessage({ message });
  return {
    "X-Node": account.address,
    "X-Node-Timestamp": String(timestamp),
    "X-Node-Signature": signature,
  };
}
