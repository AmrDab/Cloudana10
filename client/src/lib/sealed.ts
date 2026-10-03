// Sealed secrets (docs/V3_CONTRACT.md §6) — the browser half. The implementation lives in shared/sealed.ts so the
// browser and the node agent use the same ECIES (secp256k1 → HKDF-SHA256 → XChaCha20-Poly1305) code.
export * from "../../../shared/sealed";
