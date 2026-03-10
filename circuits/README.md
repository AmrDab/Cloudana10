# POUW zkSNARK Circuits

## Overview

`pouw_verify.circom` — Groth16 zkSNARK circuit that proves a POUW certificate is valid without revealing matrices A and B.

**Testnet**: Not needed — orchestrator re-runs the computation directly.
**Mainnet**: Enables trustless, O(1) on-chain verification and matrix privacy.

## Parameters

| Parameter | Testnet target | Mainnet target |
|---|---|---|
| N (matrix size) | 32 | 128–256 |
| R (block size) | 4 | 8–16 |
| Intermediates (nb³) | 512 | 4096–32768 |
| Prover time (est.) | ~30s CPU | ~5s GPU |
| Proof size (Groth16) | 192 bytes | 192 bytes |
| On-chain verify gas | ~250,000 | ~250,000 |

For N > 64, switch to Plonky2 or Nova recursive SNARKs.

## Setup (when ready for mainnet)

```bash
# Install circom
curl -LO https://github.com/iden3/circom/releases/latest/download/circom-linux-amd64
chmod +x circom-linux-amd64 && mv circom-linux-amd64 /usr/local/bin/circom

# Install circomlib
npm install circomlib

# Compile circuit (takes ~10min for N=32)
circom pouw_verify.circom --r1cs --wasm --sym

# Powers of Tau ceremony (or use existing)
snarkjs powersoftau new bn128 18 pot18_0000.ptau -v
snarkjs powersoftau contribute pot18_0000.ptau pot18_0001.ptau --name="Cloudana"
snarkjs powersoftau prepare phase2 pot18_0001.ptau pot18_final.ptau

# Groth16 setup
snarkjs groth16 setup pouw_verify.r1cs pot18_final.ptau pouw_verify_0000.zkey
snarkjs zkey contribute pouw_verify_0000.zkey pouw_verify_final.zkey --name="Cloudana"
snarkjs zkey export verificationkey pouw_verify_final.zkey verification_key.json

# Export Solidity verifier
snarkjs zkey export solidityverifier pouw_verify_final.zkey POUWzkVerifier.sol
```

## Key Design Decisions

1. **Poseidon hash** instead of SHA-256 inside the circuit (SHA-256 is ~20,000 constraints/block; Poseidon is ~250).
2. **Sequential transcript hash** — chain Poseidon hashes across all nb³ blocks rather than hashing everything at once.
3. **Low-rank noise in-circuit** — noise E, F are derived from sigma using Poseidon PRG, not passed as private inputs.
4. **Matrix privacy** — A and B are private inputs; only their Poseidon hashes are public.

## Upgrading POUWVerifier.sol for mainnet

Replace `recordCertificate()` (trusted orchestrator) with `verifyAndRecord()` that calls the Groth16 verifier:

```solidity
function verifyAndRecord(
    uint[2] calldata a_,
    uint[2][2] calldata b_,
    uint[2] calldata c_,
    uint[] calldata publicSignals
) external {
    require(POUWzkVerifier.verifyProof(a_, b_, c_, publicSignals), "Invalid zkSNARK");
    // extract provider, z, difficulty from publicSignals
    // record on-chain
}
```
