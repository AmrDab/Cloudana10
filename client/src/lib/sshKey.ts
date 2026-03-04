/**
 * Generate an Ed25519 SSH key pair in the browser using Web Crypto API.
 * Returns public key in OpenSSH format and private key in PKCS#8 PEM.
 */
export interface SshKeyPair {
  publicKey: string;
  privateKeyPem: string;
}

function openSshPublicKey(pubkey: Uint8Array, comment = "cloudana-mvp"): string {
  const algo = new TextEncoder().encode("ssh-ed25519");
  const blob = new Uint8Array(4 + algo.length + 4 + pubkey.length);
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  let off = 0;
  dv.setUint32(off, algo.length, false);
  off += 4;
  blob.set(algo, off);
  off += algo.length;
  dv.setUint32(off, pubkey.length, false);
  off += 4;
  blob.set(pubkey, off);

  let binary = "";
  for (let i = 0; i < blob.length; i++) {
    binary += String.fromCharCode(blob[i]);
  }
  const b64 = btoa(binary);
  return `ssh-ed25519 ${b64} ${comment}`;
}

function pkcs8ToPem(der: ArrayBuffer): string {
  let binary = "";
  const u8 = new Uint8Array(der);
  for (let i = 0; i < u8.length; i++) {
    binary += String.fromCharCode(u8[i]);
  }
  const b64 = btoa(binary);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.slice(i, i + 64));
  }
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`;
}

export async function generateSshEd25519KeyPair(comment = "cloudana-mvp"): Promise<SshKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );

  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubkey = new Uint8Array(rawPub);
  const publicKey = openSshPublicKey(pubkey, comment);

  const rawPriv = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const privateKeyPem = pkcs8ToPem(rawPriv);

  return { publicKey, privateKeyPem };
}

/** @deprecated Use generateSshEd25519KeyPair. Kept for backwards compat. */
export async function generateSshEd25519PublicKey(comment = "cloudana-mvp"): Promise<string> {
  const { publicKey } = await generateSshEd25519KeyPair(comment);
  return publicKey;
}
