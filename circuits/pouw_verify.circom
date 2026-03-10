pragma circom 2.1.6;

/*
 * cuPOW zkSNARK Verification Circuit
 *
 * Proves that a POUW certificate is valid WITHOUT revealing matrices A and B.
 * This replaces the testnet's "orchestrator re-runs computation" approach
 * with a trustless O(1) proof verification.
 *
 * What this circuit proves:
 *   1. The prover knows matrices A, B such that H(A) = matrixAHash (public)
 *      and H(B) = matrixBHash (public).
 *   2. Given sigma (public), the prover correctly computed the block-based
 *      MatMul_r(A+E, B+F) where E, F are derived deterministically from sigma.
 *   3. The transcript hash of all intermediates equals transcriptHash (public).
 *   4. z = H(sigma || transcriptHash || matrixAHash || matrixBHash) (public)
 *      and z < difficulty threshold.
 *
 * Circuit structure:
 *   - Input (public):  sigma, matrixAHash, matrixBHash, transcriptHash, z, difficulty
 *   - Input (private): matrixA[n*n], matrixB[n*n], noiseSeeds[4]
 *   - Output:         valid (1 if proof is correct)
 *
 * NOTE: This is a MAINNET target circuit. For testnet, the orchestrator
 * performs off-chain verification directly (no zkSNARK needed).
 *
 * The circuit is parameterized by N (matrix dimension) and R (block size).
 * Typical mainnet parameters: N=256, R=8 (nb=32, intermediates=32768 blocks).
 *
 * For large N, the circuit is enormous. Practical approach:
 *   - Use recursive SNARKs (Nova/SuperNova) to batch intermediate blocks.
 *   - Or use Plonky2 which handles large circuits more efficiently.
 *   - For Groth16 (smallest proof, cheapest on-chain verify): N <= 64.
 */

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

/*
 * Modular addition in F_p (p = 1_000_000_007).
 * Circom works natively over the BN254 scalar field (p_bn254 >> p).
 * We perform explicit mod operations.
 */
template ModAdd(p) {
    signal input a;
    signal input b;
    signal output out;
    signal sum;
    sum <== a + b;
    // sum mod p: if sum >= p, subtract p
    signal carry;
    carry <-- sum \ p;  // integer division (0 or 1 for our field sizes)
    out <== sum - carry * p;
}

/*
 * Modular multiplication in F_p.
 * Uses signal constraints to enforce c = a*b mod p.
 */
template ModMul(p) {
    signal input a;
    signal input b;
    signal output out;
    signal prod;
    prod <== a * b;
    signal q;
    q <-- prod \ p;
    out <== prod - q * p;
    // Soundness: enforce 0 <= out < p
    component lt = LessThan(30);
    lt.in[0] <== out;
    lt.in[1] <== p;
    lt.out === 1;
}

/*
 * Matrix multiplication of two r×r blocks over F_p.
 * Inputs: A[r*r], B[r*r] (flat row-major)
 * Output: C[r*r] = A × B mod p
 */
template BlockMatMul(r, p) {
    signal input A[r][r];
    signal input B[r][r];
    signal output C[r][r];

    component muls[r][r][r];
    component adds[r][r][r];

    for (var i = 0; i < r; i++) {
        for (var j = 0; j < r; j++) {
            var acc = 0;
            for (var k = 0; k < r; k++) {
                muls[i][j][k] = ModMul(p);
                muls[i][j][k].a <== A[i][k];
                muls[i][j][k].b <== B[k][j];

                adds[i][j][k] = ModAdd(p);
                adds[i][j][k].a <== (k == 0) ? 0 : adds[i][j][k-1].out;
                adds[i][j][k].b <== muls[i][j][k].out;
            }
            C[i][j] <== adds[i][j][r-1].out;
        }
    }
}

/*
 * Main POUW verification circuit.
 * Parameterized for small N=32, R=4 (Groth16 feasible).
 * For larger N, switch to Plonky2 or recursive SNARK.
 *
 * N = 32, R = 4: nb = 8 blocks per side, nb³ = 512 intermediate blocks.
 * Each block = 4×4 matrix = 16 field elements.
 * Total: 512 × 16 = 8192 field elements hashed per transcript.
 * Circuit size: ~8192 × r² × cost_per_mul ≈ manageable for Groth16.
 */
template POUWVerify(N, R, P) {
    var NB = N \ R; // blocks per side

    // ── Public inputs ──────────────────────────────────────────────────────
    signal input sigma[2];          // sigma as two 128-bit limbs (fits BN254)
    signal input matrixAHash[2];    // Poseidon hash of A
    signal input matrixBHash[2];    // Poseidon hash of B
    signal input transcriptHash[2]; // Poseidon hash of all intermediate blocks
    signal input z[2];              // final proof hash
    signal input difficultyBits;    // number of leading zero bits required

    // ── Private inputs ─────────────────────────────────────────────────────
    signal input A[N][N];  // matrix A (private — not revealed to verifier)
    signal input B[N][N];  // matrix B (private — not revealed to verifier)
    // Noise factors (derived from sigma by circuit, so no separate input needed)

    // ── Output ────────────────────────────────────────────────────────────
    signal output valid;

    // ── Step 1: Verify H(A) and H(B) match public inputs ─────────────────
    // Flatten A into N*N field elements, hash with Poseidon
    component hashA = Poseidon(N * N);
    component hashB = Poseidon(N * N);
    for (var i = 0; i < N; i++) {
        for (var j = 0; j < N; j++) {
            hashA.inputs[i * N + j] <== A[i][j];
            hashB.inputs[i * N + j] <== B[i][j];
        }
    }
    // Assert hashes match public inputs (using low limb for simplicity)
    hashA.out === matrixAHash[0];
    hashB.out === matrixBHash[0];

    // ── Step 2: Derive noise E, F from sigma (deterministic) ─────────────
    // In the circuit, we re-derive noise seeds using Poseidon(sigma || label)
    // and expand them into low-rank matrices E_L, E_R, F_L, F_R.
    // For circuit efficiency, noise derivation uses Poseidon instead of SHA-256.
    // (The on-chain contract and off-chain verifier must use the same hash.)

    // Noise seed for E
    component seedE = Poseidon(3);
    seedE.inputs[0] <== sigma[0];
    seedE.inputs[1] <== sigma[1];
    seedE.inputs[2] <== 1; // label for E

    component seedF = Poseidon(3);
    seedF.inputs[0] <== sigma[0];
    seedF.inputs[1] <== sigma[1];
    seedF.inputs[2] <== 2; // label for F

    // Expand noise seed into E_L (N×R) and E_R (R×N) using sequential Poseidon
    signal EL[N][R];
    signal ER[R][N];
    signal FL[N][R];
    signal FR[R][N];

    // For testnet circuit: use simple PRG expansion from seed
    // Each row of EL derived by hashing (seed, row_index)
    component elHash[N][R];
    component erHash[R][N];
    component flHash[N][R];
    component frHash[R][N];

    for (var i = 0; i < N; i++) {
        for (var k = 0; k < R; k++) {
            elHash[i][k] = Poseidon(3);
            elHash[i][k].inputs[0] <== seedE.out;
            elHash[i][k].inputs[1] <== i;
            elHash[i][k].inputs[2] <== k;
            EL[i][k] <== elHash[i][k].out;

            flHash[i][k] = Poseidon(3);
            flHash[i][k].inputs[0] <== seedF.out;
            flHash[i][k].inputs[1] <== i;
            flHash[i][k].inputs[2] <== k;
            FL[i][k] <== flHash[i][k].out;
        }
    }
    for (var k = 0; k < R; k++) {
        for (var j = 0; j < N; j++) {
            erHash[k][j] = Poseidon(3);
            erHash[k][j].inputs[0] <== seedE.out;
            erHash[k][j].inputs[1] <== k + N; // distinct from EL
            erHash[k][j].inputs[2] <== j;
            ER[k][j] <== erHash[k][j].out;

            frHash[k][j] = Poseidon(3);
            frHash[k][j].inputs[0] <== seedF.out;
            frHash[k][j].inputs[1] <== k + N;
            frHash[k][j].inputs[2] <== j;
            FR[k][j] <== frHash[k][j].out;
        }
    }

    // Compute E = EL × ER (N×N) and F = FL × FR (N×N)
    // (These are the low-rank noise matrices)
    // Use BlockMatMul for R×R sub-blocks to keep constraints manageable
    signal E[N][N];
    signal F_mat[N][N];

    component eCalc[N][N][R];
    component fCalc[N][N][R];
    component eAdd[N][N][R];
    component fAdd[N][N][R];

    for (var i = 0; i < N; i++) {
        for (var j = 0; j < N; j++) {
            for (var k = 0; k < R; k++) {
                eCalc[i][j][k] = ModMul(P);
                eCalc[i][j][k].a <== EL[i][k];
                eCalc[i][j][k].b <== ER[k][j];

                eAdd[i][j][k] = ModAdd(P);
                eAdd[i][j][k].a <== (k == 0) ? 0 : eAdd[i][j][k-1].out;
                eAdd[i][j][k].b <== eCalc[i][j][k].out;

                fCalc[i][j][k] = ModMul(P);
                fCalc[i][j][k].a <== FL[i][k];
                fCalc[i][j][k].b <== FR[k][j];

                fAdd[i][j][k] = ModAdd(P);
                fAdd[i][j][k].a <== (k == 0) ? 0 : fAdd[i][j][k-1].out;
                fAdd[i][j][k].b <== fCalc[i][j][k].out;
            }
            E[i][j] <== eAdd[i][j][R-1].out;
            F_mat[i][j] <== fAdd[i][j][R-1].out;
        }
    }

    // A' = A + E, B' = B + F
    signal Aprime[N][N];
    signal Bprime[N][N];
    component addAE[N][N];
    component addBF[N][N];
    for (var i = 0; i < N; i++) {
        for (var j = 0; j < N; j++) {
            addAE[i][j] = ModAdd(P);
            addAE[i][j].a <== A[i][j];
            addAE[i][j].b <== E[i][j];
            Aprime[i][j] <== addAE[i][j].out;

            addBF[i][j] = ModAdd(P);
            addBF[i][j].a <== B[i][j];
            addBF[i][j].b <== F_mat[i][j];
            Bprime[i][j] <== addBF[i][j].out;
        }
    }

    // ── Step 3: Block MatMul with transcript hash ─────────────────────────
    // Run MatMul_R(A', B'), recording all NB³ intermediate R×R blocks.
    // Hash them all with Poseidon into a rolling hash.

    signal C[N][N];
    signal intermediateHashes[NB][NB][NB]; // Poseidon of each Cij^(l)

    component blockMuls[NB][NB][NB]; // BlockMatMul for each (i,j,l)
    component blockAdd[NB][NB][NB][R][R]; // add intermediate to running Cij
    component interHash[NB][NB][NB]; // Poseidon of each intermediate block

    for (var bi = 0; bi < NB; bi++) {
        for (var bj = 0; bj < NB; bj++) {
            // Running Cij[R][R] — we need signal arrays
            for (var bl = 0; bl < NB; bl++) {
                blockMuls[bi][bj][bl] = BlockMatMul(R, P);
                // Fill block A'_{bi,bl} and B'_{bl,bj}
                for (var r_ = 0; r_ < R; r_++) {
                    for (var c_ = 0; c_ < R; c_++) {
                        blockMuls[bi][bj][bl].A[r_][c_] <== Aprime[bi*R + r_][bl*R + c_];
                        blockMuls[bi][bj][bl].B[r_][c_] <== Bprime[bl*R + r_][bj*R + c_];
                    }
                }

                // Hash this intermediate block with Poseidon
                interHash[bi][bj][bl] = Poseidon(R * R + 1);
                interHash[bi][bj][bl].inputs[0] <== (bl == 0) ? 0 : interHash[bi][bj][bl-1].out;
                for (var r_ = 0; r_ < R; r_++) {
                    for (var c_ = 0; c_ < R; c_++) {
                        interHash[bi][bj][bl].inputs[1 + r_ * R + c_] <== blockMuls[bi][bj][bl].C[r_][c_];
                    }
                }
                intermediateHashes[bi][bj][bl] <== interHash[bi][bj][bl].out;
            }
        }
    }

    // Final transcript hash = Poseidon of all NB²×NB intermediate hashes
    // (We chain them sequentially for circuit efficiency)
    signal transcriptRolling[NB*NB*NB + 1];
    transcriptRolling[0] <== 0;
    component transcriptHashers[NB*NB*NB];
    var idx = 0;
    for (var bi = 0; bi < NB; bi++) {
        for (var bj = 0; bj < NB; bj++) {
            for (var bl = 0; bl < NB; bl++) {
                transcriptHashers[idx] = Poseidon(2);
                transcriptHashers[idx].inputs[0] <== transcriptRolling[idx];
                transcriptHashers[idx].inputs[1] <== intermediateHashes[bi][bj][bl];
                transcriptRolling[idx + 1] <== transcriptHashers[idx].out;
                idx++;
            }
        }
    }

    // Assert transcript hash matches public input
    transcriptRolling[NB*NB*NB] === transcriptHash[0];

    // ── Step 4: Verify z and difficulty ───────────────────────────────────
    component zHash = Poseidon(6);
    zHash.inputs[0] <== sigma[0];
    zHash.inputs[1] <== sigma[1];
    zHash.inputs[2] <== transcriptHash[0];
    zHash.inputs[3] <== transcriptHash[1];
    zHash.inputs[4] <== matrixAHash[0];
    zHash.inputs[5] <== matrixBHash[0];
    zHash.out === z[0];

    // Check z < 2^(254 - difficultyBits) — difficulty check
    // Simplified: check that top `difficultyBits` bits of z are 0
    component n2b = Num2Bits(254);
    n2b.in <== z[0];
    // The top difficultyBits must all be 0
    component diffCheck[254];
    signal diffOk[254];
    diffOk[0] <== 1;
    for (var bit = 0; bit < 254; bit++) {
        // bit index from MSB: (253 - bit)
        var bitIdx = 253 - bit;
        diffCheck[bit] = LessThan(8);
        diffCheck[bit].in[0] <== bit;
        diffCheck[bit].in[1] <== difficultyBits;
        // If bit < difficultyBits (still in leading zeros), n2b.out[bitIdx] must be 0
        diffOk[bit + 1] <== diffOk[bit] * (1 - diffCheck[bit].out * n2b.out[bitIdx]);
    }
    valid <== diffOk[254];
    valid === 1;
}

// Instantiate for testnet parameters: N=32, R=4
component main {public [sigma, matrixAHash, matrixBHash, transcriptHash, z, difficultyBits]}
    = POUWVerify(32, 4, 1000000007);
