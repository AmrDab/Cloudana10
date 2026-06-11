# Cloudana PoUW Circuits — zkSNARK scaffold

This is the path to **trustless** PoUW verification: the milestone at which the
orchestrator leaves the critical path and "decentralized verification" becomes an
honest claim. It is a **scaffold**, not a finished trustless layer. Read the scope.

## What works today
`npm run install:deps && npm run build` gives you the full Groth16 pipeline:
compile → powers-of-tau → zkey → `verification_key.json` → `Groth16Verifier.sol`.
The circuit proves the **certificate binding** (z is the correct hash of its parts)
and the **difficulty** (z has the required leading-zero bits). That is verifiable
on-chain in O(1).

## What is NOT done (the real work)
The circuit does **not yet** prove that the transcript is the genuine transcript of
the block-matmul — i.e. that the prover actually did the useful work. That is the
hard research problem (proving an n×n matmul in-circuit explodes constraints). The
`TranscriptCorrectness` template is a stub with the interface in place. Until it's
filled, the orchestrator still attests transcript correctness, so the system is
**trust-minimized, not trustless**. Do not market it otherwise.

Realistic approaches for the heavy lift, roughly in order of practicality:
1. **Freivalds-style probabilistic check** — commit to A, B, E, F and prove a
   randomized product check. Few constraints, probabilistic soundness (tune the
   number of checks to the security target). Likely the fastest route to a real
   trustless testnet.
2. **Recursive / folding (Nova/SuperNova)** — prove per-block steps and fold, so
   circuit size is per-block not per-matrix.
3. **STARK transcript + SNARK wrapper** — STARK the matmul, wrap for on-chain
   succinctness.

## Hash choice
SHA-256 in-circuit is very expensive. The production circuit should use **Poseidon**
for the transcript/commitment hashes. The off-chain miner and verifier
(`pouw/src/cupow.ts`) must switch to the **same** Poseidon construction so the
witness matches. This is a coordinated change across miner, verifier, and circuit.

## Wiring into the contract
`npm run verifier:sol` emits `Groth16Verifier.sol`. In `POUWVerifier.sol`, replace
the orchestrator-trusted `recordCertificate(...)` path with:

```solidity
import "./Groth16Verifier.sol";
contract POUWVerifier {
    Groth16Verifier public verifier;
    function submitProof(uint[2] a, uint[2][2] b, uint[2] c, uint[5] pub) external {
        require(verifier.verifyProof(a, b, c, pub), "invalid proof");
        // pub = [aHash, bHash, transcriptHash, z, difficulty]
        // record cert; no ORCHESTRATOR_ROLE needed.
    }
}
```

At that point the orchestrator is out of the verification path and emission is
gated by a proof the chain checked itself.
