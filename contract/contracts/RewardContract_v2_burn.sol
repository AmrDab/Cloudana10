// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * RewardContract — TOKENOMICS v2 PATCH (fee burn on real usage).
 *
 * This file shows the ADDITIONS/CHANGES to your existing RewardContract.sol.
 * The goal: every workload payment burns a slice of CLD, so token scarcity is
 * driven by REAL demand (the "CLD already has value because users pay for work"
 * point). Combined with EmissionController's tail emission, the network reaches a
 * dynamic equilibrium (the "soft cap") where burn ≈ emission at steady-state usage.
 *
 * Apply these edits into contract/contracts/RewardContract.sol.
 * ───────────────────────────────────────────────────────────────────────────
 */

interface ICLDBurnable {
    function burn(uint256 amount) external;
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

abstract contract RewardContractV2Additions {
    // ── New state ─────────────────────────────────────────────────────────────
    /// Basis points of each workload payment that are BURNED (e.g. 200 = 2.00%).
    uint256 public constant BURN_BPS = 200;
    /// Basis points routed to treasury as protocol fee (e.g. 50 = 0.50%).
    uint256 public constant TREASURY_BPS = 50;
    uint256 public constant BPS_DENOM = 10_000;

    address public treasury;
    uint256 public totalBurned;      // cumulative CLD burned (transparency)
    uint256 public totalToTreasury;  // cumulative protocol fees

    event PaymentBurned(uint256 indexed workloadId, uint256 burned, uint256 toTreasury);

    // Assumes `settlementToken` is CLD (or a CLD-burnable token). If you settle in
    // a stablecoin instead, route the burn through a buy-and-burn swap off-chain
    // and call recordBurn() — but native-CLD settlement gives the cleanest sink.
    ICLDBurnable internal cldSettlement;

    /**
     * @notice Replacement for fundWorkload(): splits the incoming payment into
     *         (burn, treasury, escrow-for-provider) BEFORE escrowing.
     *
     *   userPays = amount
     *   burned    = amount * BURN_BPS / 10000      -> destroyed (deflationary sink)
     *   treasury  = amount * TREASURY_BPS / 10000  -> protocol/dev
     *   escrowed  = remainder                       -> paid to provider on completion
     */
    function _fundWorkloadV2(
        uint256 workloadId,
        uint256 amount,
        mapping(uint256 => uint256) storage workloadDeposits
    ) internal returns (uint256 escrowed) {
        require(amount > 0, "Amount must be > 0");
        require(
            cldSettlement.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );

        uint256 burned   = (amount * BURN_BPS) / BPS_DENOM;
        uint256 toTreas  = (amount * TREASURY_BPS) / BPS_DENOM;
        escrowed = amount - burned - toTreas;

        if (burned > 0) {
            cldSettlement.burn(burned);
            totalBurned += burned;
        }
        if (toTreas > 0 && treasury != address(0)) {
            cldSettlement.transfer(treasury, toTreas);
            totalToTreasury += toTreas;
        }

        workloadDeposits[workloadId] += escrowed;
        emit PaymentBurned(workloadId, burned, toTreas);
    }
}
