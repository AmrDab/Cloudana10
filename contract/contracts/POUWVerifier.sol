// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title POUWVerifier
 * @dev Lightweight on-chain verifier for Proof of Useful Work certificates.
 *
 * Based on "Proofs of Useful Work from Arbitrary Matrix Multiplication"
 * (Komargodski & Weinstein, 2025). Full transcript verification is done
 * off-chain by the challenger network. On-chain we verify:
 *   1. EIP-712 provider signature
 *   2. Seed = keccak256(jobId + blockHash + chainId) — replay prevention
 *   3. transcriptHash < DIFFICULTY_TARGET — proof of work
 *
 * The seed mechanism is critical: it binds each proof to a specific job and
 * block, making previously computed transcripts worthless for new jobs.
 * This implements the paper's σ (seed) freshness requirement from Section 5.
 */
contract POUWVerifier is EIP712 {
    using ECDSA for bytes32;

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @dev Difficulty target. Proof accepted iff transcriptHash < target.
    /// Equivalent to requiring leading zeros in the transcript hash.
    uint256 public constant DIFFICULTY_TARGET =
        0x0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

    bytes32 private constant POUW_CERT_TYPEHASH = keccak256(
        "POUWCertificate(bytes32 jobId,bytes32 seed,uint256 matrixDim,uint256 blockSize,bytes32 transcriptHash,bytes32 resultHash)"
    );

    // ─── Structs ──────────────────────────────────────────────────────────────

    /**
     * @dev POUW Certificate — the on-chain representation of a completed useful work proof.
     * @param jobId     Unique job identifier (prevents cross-job replay)
     * @param seed      keccak256(jobId, blockHash, chainId) — per-job freshness seed
     * @param matrixDim n: dimension of the square matrices being multiplied
     * @param blockSize r: tile size for block matrix multiplication (r << n)
     * @param transcriptHash keccak256 of all (n/r)^3 intermediate block hashes.
     *                       This is the PoW artifact — must be < DIFFICULTY_TARGET.
     * @param resultHash keccak256 of the output matrix C = A*B
     */
    struct POUWCertificate {
        bytes32 jobId;
        bytes32 seed;
        uint256 matrixDim;
        uint256 blockSize;
        bytes32 transcriptHash;
        bytes32 resultHash;
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    /// @dev Track used seeds to prevent replay attacks
    mapping(bytes32 => bool) public usedSeeds;

    /// @dev Verified certificates by jobId
    mapping(bytes32 => POUWCertificate) public verifiedCerts;

    /// @dev Block number at which each job's proof was submitted
    mapping(bytes32 => uint256) public proofBlockNumber;

    // ─── Events ───────────────────────────────────────────────────────────────

    event POUWVerified(
        bytes32 indexed jobId,
        address indexed provider,
        bytes32 transcriptHash,
        bytes32 seed,
        uint256 blockNumber
    );

    event ReplayAttackBlocked(
        bytes32 indexed seed,
        address indexed attacker
    );

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() EIP712("POUWVerifier", "1") {}

    // ─── Core Functions ───────────────────────────────────────────────────────

    /**
     * @notice Verify a POUW certificate and record it on-chain.
     * @param cert          The POUW certificate from the provider
     * @param jobBlockNumber Block number when the job was assigned (for seed verification)
     * @param providerSig   EIP-712 signature over the certificate
     * @return provider     The verified provider address
     */
    function verifyCertificate(
        POUWCertificate calldata cert,
        uint256 jobBlockNumber,
        bytes calldata providerSig
    ) external returns (address provider) {
        // 1. Verify EIP-712 signature
        bytes32 structHash = _hashCert(cert);
        bytes32 digest = _hashTypedDataV4(structHash);
        provider = digest.recover(providerSig);
        require(provider != address(0), "POUWVerifier: invalid signature");

        // 2. Replay attack prevention: verify seed is fresh
        require(!usedSeeds[cert.seed], "POUWVerifier: seed already used (replay)");
        bytes32 expectedSeed = computeSeed(cert.jobId, blockhash(jobBlockNumber));
        require(cert.seed == expectedSeed, "POUWVerifier: invalid seed");

        // 3. Verify difficulty target met
        require(
            uint256(cert.transcriptHash) < DIFFICULTY_TARGET,
            "POUWVerifier: difficulty not met"
        );

        // 4. Verify matrix dimensions are valid
        require(cert.matrixDim > 0 && cert.blockSize > 0, "POUWVerifier: invalid dimensions");
        require(cert.matrixDim % cert.blockSize == 0, "POUWVerifier: blockSize must divide matrixDim");

        // 5. Record and mark seed as used
        usedSeeds[cert.seed] = true;
        verifiedCerts[cert.jobId] = cert;
        proofBlockNumber[cert.jobId] = block.number;

        emit POUWVerified(cert.jobId, provider, cert.transcriptHash, cert.seed, block.number);

        return provider;
    }

    /**
     * @notice Compute the replay-prevention seed for a job.
     * @dev seed = keccak256(jobId || blockHash || chainId)
     *      The block hash ensures the seed is unguessable before block confirmation.
     *      The chainId prevents cross-chain replay.
     * @param jobId     The unique job identifier
     * @param blockHash The hash of the block when the job was assigned
     */
    function computeSeed(bytes32 jobId, bytes32 blockHash) public view returns (bytes32) {
        return keccak256(abi.encodePacked(jobId, blockHash, block.chainid));
    }

    /**
     * @notice Check if a proof has been verified for a given job.
     */
    function isVerified(bytes32 jobId) external view returns (bool) {
        return proofBlockNumber[jobId] > 0;
    }

    /**
     * @notice Get the transcript hash for a verified job.
     */
    function getTranscriptHash(bytes32 jobId) external view returns (bytes32) {
        return verifiedCerts[jobId].transcriptHash;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _hashCert(POUWCertificate calldata cert) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            POUW_CERT_TYPEHASH,
            cert.jobId,
            cert.seed,
            cert.matrixDim,
            cert.blockSize,
            cert.transcriptHash,
            cert.resultHash
        ));
    }
}
