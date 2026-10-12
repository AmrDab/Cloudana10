// Relay tickets (docs/V4_RELAY_CONTRACT.md): the API, after checking a node's signed request, hands it a short-lived
// HMAC ticket; the relay checks the ticket with the same secret, so it needs neither node keys nor the database.
// Format: `<node address>.<expiry ms>.<nonce hex>.<hmac hex>`. Web Crypto only (Workers and Node 22).

export const TICKET_TTL_MS = 60_000;

const enc = new TextEncoder();
const ADDRESS = /^0x[0-9a-f]{40}$/;
const NONCE = /^[0-9a-f]{32}$/;
const SIG = /^[0-9a-f]{64}$/;

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function hmac(secret: string, message: string): Promise<string> {
  if (secret.length < 32) throw new Error("relay ticket secret must be at least 32 characters");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Issue a ticket for `node` (lower-case 0x address) valid for TICKET_TTL_MS. */
export async function issueTicket(secret: string, node: string, now = Date.now()): Promise<{ ticket: string; expiresAt: number }> {
  const address = node.toLowerCase();
  if (!ADDRESS.test(address)) throw new Error("bad node address");
  const expiresAt = now + TICKET_TTL_MS;
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const body = `${address}.${expiresAt}.${nonce}`;
  return { ticket: `${body}.${await hmac(secret, body)}`, expiresAt };
}

export interface TicketClaims {
  node: string;
  expiresAt: number;
  nonce: string;
}

/** The ticket's claims if the signature is right and it has not expired; null otherwise. Single use is the relay's job. */
export async function verifyTicket(secret: string, ticket: string, now = Date.now()): Promise<TicketClaims | null> {
  const parts = ticket.split(".");
  if (parts.length !== 4) return null;
  const [node, exp, nonce, sig] = parts;
  if (!ADDRESS.test(node) || !/^\d{13}$/.test(exp) || !NONCE.test(nonce) || !SIG.test(sig)) return null;
  const expiresAt = Number(exp);
  if (expiresAt <= now || expiresAt > now + TICKET_TTL_MS + 5_000) return null;
  const want = await hmac(secret, `${node}.${exp}.${nonce}`);
  // Constant-time compare over equal-length hex strings.
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? { node, expiresAt, nonce } : null;
}
