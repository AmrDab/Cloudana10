// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./StakingManager.sol";
import "./POUWVerifier.sol";

/**
 * @title ChallengeManager
 * @dev Implements the challenger network for Cloudana's fraud proof system.
 *
 * Challenger network design:
 *   1. When a provider submits a POUW proof, a 50-block challenge window opens.
 *   2. A challenger is pseudo-randomly selected using block.prevrandao.
 *      The selected challenger MUST challenge within a 10-block mandate window
 *      or lose 10% of their stake (ensures challenges actually happen).
 *   3. Any registered challenger can also open a voluntary challenge.
 *   4. Challenged provider must respond with the full transcript within 25 blocks.
 *   5. Off-chain: challenger downloads transcript, verifies each intermediate block.
 *      If fraud found, submits the conflicting transcript hash on-chain.
 *   6. If provider fails to respond OR transcript is invalid: provider slashed,
 *      challenger rewarded. If transcript is valid: challenger slashed (false challenge).
 *
 * This implements the multi-layer challenger network from the Cloudana whitepaper,
 * grounded in the POUW paper's off-chain verification model (Remark 2.2).
 */
contract ChallengeManager is ReentrancyGuard, AccessControl {

    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant CHALLENGE_WINDOW = 50;        // blocks (~10 min on Base)
    uint256 public constant RESPONSE_WINDOW = 25;         // blocks for provider to respond
    uint256 public constant MANDATE_WINDOW = 10;          // blocks for mandated challenger to act
    uint256 public constant CHALLENGER_MIN_STAKE = 500 ether; // 500 CLD to register as challenger
    uint256 public constant CHALLENGE_DEPOSIT = 100 ether;    // Deposit per challenge
    uint256 public constant MANDATE_PENALTY_PCT = 10;         // 10% slash for missed mandate

    // ─── Structs ──────────────────────────────────────────────────────────────

    enum ChallengeStatus { OPEN, RESPONDED, FRAUD_PROVEN, RESOLVED, EXPIRED }

    struct Challenge {
        bytes32 jobId;
        address provider;
        address challenger;
        uint256 openBlock;
        uint256 deposit;
        bytes32 fraudTranscriptHash; // challenger's claimed correct hash
        bool providerResponded;
        bytes32 providerTranscriptHash;
        ChallengeStatus status;
    }

    struct ChallengerInfo {
        uint256 stake;
        uint256 challengesWon;
        uint256 challengesLost;
        bool registered;
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    IERC20 public immutable cldToken;
    StakingManager public immutable stakingManager;
    POUWVerifier public immutable pouwVerifier;

    mapping(bytes32 => Challenge) public challenges;
    mapping(bytes32 => bool) public jobChallenged;
    mapping(bytes32 => uint256) public jobProofBlock; // block when proof was submitted

    mapping(address => ChallengerInfo) public challengers;
    address[] public challengerList;

    // Mandated challengers: jobId => address
    mapping(bytes32 => address) public mandatedChallenger;
    // Track if mandated challenger acted
    mapping(bytes32 => bool) public mandateActed;

    // ─── Events ───────────────────────────────────────────────────────────────

    event ChallengerRegistered(address indexed challenger, uint256 stake);
    event ChallengeOpened(bytes32 indexed challengeId, bytes32 indexed jobId, address indexed challenger);
    event ProviderResponded(bytes32 indexed challengeId, bytes32 transcriptHash);
    event FraudProven(bytes32 indexed challengeId, address indexed provider, address indexed challenger);
    event FalseChallenge(bytes32 indexed challengeId, address indexed challenger);
    event ChallengeExpired(bytes32 indexed challengeId);
    event MandatedChallengerSelected(bytes32 indexed jobId, address indexed challenger);
    event MandateMissed(bytes32 indexed jobId, address indexed challenger);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address _cldToken,
        address _stakingManager,
        address _pouwVerifier
    ) {
        cldToken = IERC20(_cldToken);
        stakingManager = StakingManager(_stakingManager);
        pouwVerifier = POUWVerifier(_pouwVerifier);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ─── Challenger Registration ───────────────────────────────────────────────

    /**
     * @notice Register as a challenger by staking CLD.
     *         Challengers earn rewards for catching fraud.
     */
    function registerChallenger(uint256 stakeAmount) external nonReentrant {
        require(stakeAmount >= CHALLENGER_MIN_STAKE, "ChallengeManager: below min stake");
        require(!challengers[msg.sender].registered, "ChallengeManager: already registered");
        require(cldToken.transferFrom(msg.sender, address(this), stakeAmount), "ChallengeManager: transfer failed");

        challengers[msg.sender] = ChallengerInfo({
            stake: stakeAmount,
            challengesWon: 0,
            challengesLost: 0,
            registered: true
        });
        challengerList.push(msg.sender);

        emit ChallengerRegistered(msg.sender, stakeAmount);
    }

    // ─── Mandated Challenge Selection ─────────────────────────────────────────

    /**
     * @notice Select a mandatory challenger for a job using pseudo-random selection.
     *         Called when a POUW proof is submitted.
     *         Uses block.prevrandao for unpredictability (EIP-4399 post-Merge).
     *
     * @dev This prevents collusion: providers can't know in advance who will challenge.
     *      The selected challenger MUST challenge or lose MANDATE_PENALTY_PCT of stake.
     */
    function selectMandatedChallenger(bytes32 jobId, uint256 proofBlock) external {
        require(challengerList.length > 0, "ChallengeManager: no challengers registered");
        require(mandatedChallenger[jobId] == address(0), "ChallengeManager: already selected");

        // Use prevrandao + jobId for unpredictable selection
        uint256 idx = uint256(keccak256(abi.encodePacked(jobId, block.prevrandao))) % challengerList.length;
        address selected = challengerList[idx];

        mandatedChallenger[jobId] = selected;
        jobProofBlock[jobId] = proofBlock;

        emit MandatedChallengerSelected(jobId, selected);
    }

    /**
     * @notice Slash a challenger who missed their mandate window.
     */
    function enforceMissedMandate(bytes32 jobId) external {
        address mandated = mandatedChallenger[jobId];
        require(mandated != address(0), "ChallengeManager: no mandate");
        require(!mandateActed[jobId], "ChallengeManager: mandate was acted on");
        require(
            block.number > jobProofBlock[jobId] + MANDATE_WINDOW,
            "ChallengeManager: mandate window still open"
        );

        // Slash 10% of their stake
        uint256 penalty = (challengers[mandated].stake * MANDATE_PENALTY_PCT) / 100;
        challengers[mandated].stake -= penalty;

        // Burn the penalty
        cldToken.transfer(address(0x000000000000000000000000000000000000dEaD), penalty);

        emit MandateMissed(jobId, mandated);
    }

    // ─── Challenge Lifecycle ──────────────────────────────────────────────────

    /**
     * @notice Open a challenge against a provider's submitted POUW proof.
     * @param jobId           The job whose proof is being challenged
     * @param fraudTranscript The challenger's claim of what the correct transcript hash should be
     */
    function openChallenge(
        bytes32 jobId,
        address provider,
        bytes32 fraudTranscript
    ) external nonReentrant returns (bytes32 challengeId) {
        require(!jobChallenged[jobId], "ChallengeManager: already challenged");
        require(
            block.number <= jobProofBlock[jobId] + CHALLENGE_WINDOW,
            "ChallengeManager: challenge window expired"
        );
        require(challengers[msg.sender].registered, "ChallengeManager: not a registered challenger");
        require(cldToken.transferFrom(msg.sender, address(this), CHALLENGE_DEPOSIT), "ChallengeManager: deposit failed");

        // Mark mandate as acted if this is the mandated challenger
        if (mandatedChallenger[jobId] == msg.sender) {
            mandateActed[jobId] = true;
        }

        challengeId = keccak256(abi.encodePacked(jobId, msg.sender, block.number));

        challenges[challengeId] = Challenge({
            jobId: jobId,
            provider: provider,
            challenger: msg.sender,
            openBlock: block.number,
            deposit: CHALLENGE_DEPOSIT,
            fraudTranscriptHash: fraudTranscript,
            providerResponded: false,
            providerTranscriptHash: bytes32(0),
            status: ChallengeStatus.OPEN
        });

        jobChallenged[jobId] = true;

        // Freeze provider's unstake during challenge
        stakingManager.incrementChallengeCount(provider);

        emit ChallengeOpened(challengeId, jobId, msg.sender);
        return challengeId;
    }

    /**
     * @notice Provider responds to a challenge by submitting their full transcript hash.
     *         Off-chain: the challenger can then verify each block in the transcript.
     */
    function respondToChallenge(
        bytes32 challengeId,
        bytes32 transcriptHash
    ) external {
        Challenge storage c = challenges[challengeId];
        require(c.status == ChallengeStatus.OPEN, "ChallengeManager: challenge not open");
        require(msg.sender == c.provider, "ChallengeManager: not the provider");
        require(
            block.number <= c.openBlock + RESPONSE_WINDOW,
            "ChallengeManager: response window expired"
        );

        c.providerTranscriptHash = transcriptHash;
        c.providerResponded = true;
        c.status = ChallengeStatus.RESPONDED;

        emit ProviderResponded(challengeId, transcriptHash);
    }

    /**
     * @notice Submit a fraud proof. Called by the challenger after verifying the
     *         full transcript off-chain and finding a discrepancy.
     *
     * @dev The fraud proof is the specific block index where the provider's computation
     *      diverges from the correct result. Off-chain verification matches the paper's
     *      Remark 2.2 design — SNARKs are optional and amortized.
     *
     * @param challengeId      The challenge being resolved
     * @param fraudBlockIndex  Which intermediate block (i,j,l) is incorrect
     * @param expectedHash     What the correct block hash should be
     */
    function submitFraudProof(
        bytes32 challengeId,
        uint256 fraudBlockIndex,
        bytes32 expectedHash
    ) external onlyRole(RESOLVER_ROLE) nonReentrant {
        Challenge storage c = challenges[challengeId];
        require(
            c.status == ChallengeStatus.OPEN || c.status == ChallengeStatus.RESPONDED,
            "ChallengeManager: invalid status"
        );

        c.status = ChallengeStatus.FRAUD_PROVEN;

        // Slash provider: 50% of stake
        uint256 providerStake = stakingManager.getStake(c.provider);
        uint256 slashAmount = (providerStake * 50) / 100;
        stakingManager.slash(c.provider, slashAmount, c.challenger);
        stakingManager.decrementChallengeCount(c.provider);

        // Return challenger's deposit + bonus
        cldToken.transfer(c.challenger, c.deposit);
        challengers[c.challenger].challengesWon++;

        emit FraudProven(challengeId, c.provider, c.challenger);
    }

    /**
     * @notice Resolve a challenge as false (provider's transcript is valid).
     *         Slashes the challenger for wasting everyone's time.
     */
    function resolveFalseChallenge(bytes32 challengeId) external onlyRole(RESOLVER_ROLE) nonReentrant {
        Challenge storage c = challenges[challengeId];
        require(c.status == ChallengeStatus.RESPONDED, "ChallengeManager: provider must have responded");

        c.status = ChallengeStatus.RESOLVED;

        // Slash challenger's deposit (false challenge penalty)
        uint256 penalty = c.deposit;
        challengers[c.challenger].stake -= (penalty < challengers[c.challenger].stake ? penalty : challengers[c.challenger].stake);
        challengers[c.challenger].challengesLost++;

        // Unfreeze provider
        stakingManager.decrementChallengeCount(c.provider);

        emit FalseChallenge(challengeId, c.challenger);
    }

    /**
     * @notice Resolve an expired challenge where provider failed to respond.
     *         Provider is auto-slashed for non-response.
     */
    function resolveExpiredChallenge(bytes32 challengeId) external nonReentrant {
        Challenge storage c = challenges[challengeId];
        require(c.status == ChallengeStatus.OPEN, "ChallengeManager: not open");
        require(
            block.number > c.openBlock + RESPONSE_WINDOW,
            "ChallengeManager: response window still active"
        );

        c.status = ChallengeStatus.EXPIRED;

        // Provider failed to respond = assumed fraud, slash them
        uint256 providerStake = stakingManager.getStake(c.provider);
        uint256 slashAmount = (providerStake * 50) / 100;
        stakingManager.slash(c.provider, slashAmount, c.challenger);
        stakingManager.decrementChallengeCount(c.provider);

        // Return challenger deposit + reward
        cldToken.transfer(c.challenger, c.deposit);
        challengers[c.challenger].challengesWon++;

        emit ChallengeExpired(challengeId);
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    function getChallenge(bytes32 challengeId) external view returns (Challenge memory) {
        return challenges[challengeId];
    }

    function getChallengerCount() external view returns (uint256) {
        return challengerList.length;
    }

    function isWindowOpen(bytes32 jobId) external view returns (bool) {
        return block.number <= jobProofBlock[jobId] + CHALLENGE_WINDOW;
    }

    function getMandatedChallenger(bytes32 jobId) external view returns (address) {
        return mandatedChallenger[jobId];
    }
}
