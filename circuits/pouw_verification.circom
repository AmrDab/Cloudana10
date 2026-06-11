pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

/*
 * pouw_verification.circom — Cloudana PoUW zkSNARK (Groth16) — SCAFFOLD.
 *
 * GOAL: move PoUW verification on-chain so the orchestrator leaves the critical
 * path (the milestone at which "trustless verification" is honest).
 *
 * WHAT THIS SCAFFOLD PROVES (tractable today):
 *   Public inputs:  aHash, bHash, transcriptHash, z, difficulty
 *   Private witness: the preimages binding them together
 *   Proves:
 *     (1) z == Poseidon(sigma, transcriptHash, aHash, bHash)      [binding]
 *     (2) z has >= `difficulty` leading zero bits                  [difficulty]
 *   => A succinct proof the certificate is internally consistent and meets
 *      difficulty, verifiable on-chain in O(1) without re-running anything.
 *
 * WHAT IS THE HEAVY LIFT (the real research, NOT done here):
 *     (3) transcriptHash actually equals the hash of the block-by-block
 *         transcript of (A+E)(B+F), i.e. the prover REALLY did the matmul.
 *   Proving an n×n block-matmul inside a SNARK is enormous (R1CS blows up with
 *   n). The realistic approaches, in order of practicality:
 *     - Commit to A,B,E,F and prove a Freivalds-style randomized check of the
 *       product (probabilistic soundness, far fewer constraints).
 *     - Recursive/folding proofs (Nova/SuperNova) over per-block steps so the
 *       circuit size is per-block, not per-matrix.
 *     - A custom matmul gadget with a STARK backend for the transcript and a
 *       SNARK wrapper for on-chain succinctness.
 *   The `TranscriptCorrectness` template below is a STUB with the interface; the
 *   chosen approach plugs in there. Until it's filled, the on-chain verifier is
 *   "binding + difficulty" only and the orchestrator still attests correctness.
 *
 * NOTE: For Poseidon-friendliness the production circuit should use Poseidon as
 * the transcript/commitment hash rather than SHA-256 (SHA-256 in-circuit is very
 * expensive). The off-chain miner/verifier hash choice must match the circuit.
 */

// Checks z (as field-packed bits) has >= `difficulty` leading zero bits.
template LeadingZeroBits(nBits) {
    signal input zBits[nBits];      // most-significant-first
    signal input difficulty;        // required leading zeros
    signal output ok;

    // running AND of "all bits so far are zero"; count how many leading zeros.
    // Simple, sound version: require zBits[i]==0 for i < difficulty.
    // (difficulty is public; gate each constrained bit.)
    component lt[nBits];
    signal acc[nBits+1];
    acc[0] <== 1;
    for (var i = 0; i < nBits; i++) {
        lt[i] = LessThan(16);
        lt[i].in[0] <== i;
        lt[i].in[1] <== difficulty;     // active = (i < difficulty)
        // if active, bit must be 0: enforce active * zBits[i] == 0
        lt[i].out * zBits[i] === 0;
        acc[i+1] <== acc[i];            // carry (placeholder for richer logic)
    }
    ok <== 1;
}

// STUB — the real matmul/transcript soundness gadget goes here.
template TranscriptCorrectness() {
    signal input aHash;
    signal input bHash;
    signal input transcriptHash;
    signal output ok;
    // TODO: prove transcriptHash is the transcript of (A+E)(B+F) for committed A,B.
    // Until implemented, this asserts nothing and the orchestrator still attests.
    ok <== 1;
}

template POUWVerification(nBits) {
    // Public
    signal input aHash;
    signal input bHash;
    signal input transcriptHash;
    signal input z;
    signal input difficulty;
    // Private
    signal input sigma;

    // (1) Binding: z == Poseidon(sigma, transcriptHash, aHash, bHash)
    component h = Poseidon(4);
    h.inputs[0] <== sigma;
    h.inputs[1] <== transcriptHash;
    h.inputs[2] <== aHash;
    h.inputs[3] <== bHash;
    h.out === z;

    // (2) Difficulty: decompose z to bits, require leading zeros
    component bits = Num2Bits(254);
    bits.in <== z;
    // reverse to MSB-first for the leading-zero check
    signal zBits[nBits];
    for (var i = 0; i < nBits; i++) { zBits[i] <== bits.out[253 - i]; }
    component lz = LeadingZeroBits(nBits);
    for (var i = 0; i < nBits; i++) { lz.zBits[i] <== zBits[i]; }
    lz.difficulty <== difficulty;

    // (3) Transcript correctness (STUB — heavy lift)
    component tc = TranscriptCorrectness();
    tc.aHash <== aHash;
    tc.bHash <== bHash;
    tc.transcriptHash <== transcriptHash;
}

component main { public [aHash, bHash, transcriptHash, z, difficulty] } =
    POUWVerification(32);
