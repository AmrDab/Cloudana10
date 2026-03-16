// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title POUWVerifier
 * @dev On-chain registry for verified Proof of Useful Work certificates.
 *
 * For testnet: the orchestrator (ORCHESTRATOR_ROLE) performs off-chain verification
 * and records accepted certificates here. The contract does NOT re-verify math —
 * it trusts the orchestrator. This is acceptable for testnet where the orchestrator
 * is the trusted coordinator.
 *
 * For mainnet: replace the orchestrator submission with a Groth16 zkSNARK
 * verifier (using Circom + snarkjs) so verification is fully trustless and
 * the orchestrator is no longer needed in the critical path.
 *
 * What this contract provides:
 *   - Immutable on-chain record of all accepted certificates (for transparency).
 *   - Per-provider certificate counts and total difficulty (for reputation/rewards).
 *   - Replay protection (duplicate z values rejected).
 *   - Events for frontend real-time monitoring.
 *   - Mining reward pool funding + distribution hooks.
 */
contract POUWVerifier is AccessControl, ReentrancyGuard {
    bytes32 public constant ORCHESTRATOR_ROLE = keccak256("ORCHESTRATOR_ROLE");

    // ─── Data Structures ────────────────────────────────────────────────────

    struct Certificate {
        address provider;           // Provider wallet
        bytes32 deviceId;           // Provider device ID
        uint32 matrixSize;          // n (matrix dimension)
        uint8 difficulty;           // Leading zero bits required
        bytes32 transcriptHash;     // SHA-256 of all intermediate blocks
        bytes32 z;                  // Final proof hash (meets difficulty)
        uint256 timestamp;          // Mined at (unix ms from provider, not block time)
        uint256 blockNumber;        // Chain block number when recorded
    }

    struct ProviderStats {
        uint256 totalCertificates;
        uint256 totalDifficulty;    // Sum of all difficulty values (proxy for total work)
        uint256 lastSubmittedBlock;
        bool registered;
    }

    // ─── State ──────────────────────────────────────────────────────────────

    /// All accepted certificates, indexed by ID (1-based).
    mapping(uint256 => Certificate) public certificates;
    uint256 public certificateCount;

    /// Per-provider mining stats.
    mapping(address => ProviderStats) public providerStats;

    /// Replay protection: z values that have already been accepted.
    mapping(bytes32 => bool) public usedZ;

    /// Registered providers who have submitted at least one certificate.
    address[] public miners;

    // ─── Events ─────────────────────────────────────────────────────────────

    event CertificateRecorded(
        uint256 indexed certificateId,
        address indexed provider,
        bytes32 indexed deviceId,
        uint32 matrixSize,
        uint8 difficulty,
        bytes32 transcriptHash,
        bytes32 z,
        uint256 blockNumber
    );

    event MinerRegistered(address indexed provider, bytes32 indexed deviceId);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ─── Orchestrator Functions ──────────────────────────────────────────────

    /**
     * @notice Record a verified POUW certificate on-chain.
     * @dev Called by the orchestrator after off-chain verification passes.
     *
     * @param provider       Provider wallet address.
     * @param deviceId       Provider device ID (bytes32).
     * @param matrixSize     n (matrix dimension).
     * @param difficulty     Leading zero bits in z.
     * @param transcriptHash SHA-256 transcript hash (as bytes32).
     * @param z              Final proof hash (as bytes32).
     * @param timestamp      Unix ms timestamp from provider.
     */
    function recordCertificate(
        address provider,
        bytes32 deviceId,
        uint32 matrixSize,
        uint8 difficulty,
        bytes32 transcriptHash,
        bytes32 z,
        uint256 timestamp
    ) external onlyRole(ORCHESTRATOR_ROLE) nonReentrant {
        require(provider != address(0), "Invalid provider address");
        require(matrixSize >= 8, "Matrix size too small");
        require(difficulty >= 1 && difficulty <= 255, "Invalid difficulty");
        require(!usedZ[z], "Certificate z already recorded (replay)");

        usedZ[z] = true;
        uint256 certId = ++certificateCount;

        certificates[certId] = Certificate({
            provider: provider,
            deviceId: deviceId,
            matrixSize: matrixSize,
            difficulty: difficulty,
            transcriptHash: transcriptHash,
            z: z,
            timestamp: timestamp,
            blockNumber: block.number
        });

        // Update provider stats
        ProviderStats storage stats = providerStats[provider];
        if (!stats.registered) {
            stats.registered = true;
            miners.push(provider);
            emit MinerRegistered(provider, deviceId);
        }
        stats.totalCertificates++;
        stats.totalDifficulty += difficulty;
        stats.lastSubmittedBlock = block.number;

        emit CertificateRecorded(
            certId,
            provider,
            deviceId,
            matrixSize,
            difficulty,
            transcriptHash,
            z,
            block.number
        );
    }

    // ─── View Functions ──────────────────────────────────────────────────────

    /**
     * @notice Get mining leaderboard — top providers by total difficulty.
     * @dev Returns up to `limit` providers sorted off-chain (caller sorts).
     */
    function getMinerStats(address provider)
        external
        view
        returns (
            uint256 totalCertificates,
            uint256 totalDifficulty,
            uint256 lastSubmittedBlock
        )
    {
        ProviderStats storage stats = providerStats[provider];
        return (stats.totalCertificates, stats.totalDifficulty, stats.lastSubmittedBlock);
    }

    /** @notice Total number of registered miners. */
    function minerCount() external view returns (uint256) {
        return miners.length;
    }

    /**
     * @notice Get a certificate by ID.
     */
    function getCertificate(uint256 certId)
        external
        view
        returns (Certificate memory)
    {
        require(certId > 0 && certId <= certificateCount, "Invalid certificate ID");
        return certificates[certId];
    }

    /**
     * @notice Check if a z value has been used (replay protection query).
     */
    function isZUsed(bytes32 z) external view returns (bool) {
        return usedZ[z];
    }
}
