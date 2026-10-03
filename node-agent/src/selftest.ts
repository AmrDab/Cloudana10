import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { sha256hex, signRequest } from "./signing.ts";

async function main() {
  const account = privateKeyToAccount(generatePrivateKey());
  const method = "POST";
  const path = "/v1/nodes/heartbeat";
  const bodyStr = "{}";

  const headers = await signRequest(account, method, path, bodyStr);
  const message = `${method} ${path} ${headers["X-Node-Timestamp"]} ${sha256hex(bodyStr)}`;

  const valid = await verifyMessage({
    address: account.address,
    message,
    signature: headers["X-Node-Signature"] as `0x${string}`,
  });

  if (!valid) {
    console.error("✗ selftest failed: signature did not verify");
    process.exit(1);
  }
  console.log(`✓ selftest passed — signed & verified "${method} ${path}" for ${account.address}`);
}

main();
