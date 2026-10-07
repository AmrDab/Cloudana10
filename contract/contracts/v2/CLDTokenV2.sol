// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title CLDTokenV2
 * @notice Cloudana token, fresh deploy (IMPL_SPEC_2026-10 "Settlement contract v2").
 *         - `initialSupply` minted to `treasury` at construction.
 *         - MINTER_ROLE mints; after the deploy script only CloudanaSettlementV2 holds it.
 *         - Annual NET mint ceiling: within a schedule year (365 days from deployment), mints minus burns may not
 *           exceed `maxMintBpsPerYear` of the total supply observed at that year's start (year 0: the initial supply).
 *           Net, not gross: burn-and-mint settlement re-mints ~98% of every fee it burns, so a gross ceiling would
 *           stop provider payouts as soon as yearly fees passed 10% of supply. A backstop against a compromised
 *           minter, independent of the settlement's own emission schedule.
 */
contract CLDTokenV2 is ERC20, ERC20Burnable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant YEAR = 365 days;

    /// @notice Ceiling on net mints (mints − burns) per year, in bps of the supply at the year's start (spec default 1000 = 10%).
    uint256 public immutable maxMintBpsPerYear;
    /// @notice Timestamp the yearly ceiling windows are counted from (deployment).
    uint256 public immutable mintYearStart;

    /// @notice Schedule year the ceiling counters refer to.
    uint256 public ceilingYear;
    /// @notice Total supply when `ceilingYear` was entered (snapshot at its first mint; year 0: initial supply).
    uint256 public supplyAtYearStart;
    /// @notice Gross amount minted so far in `ceilingYear`.
    uint256 public mintedThisYear;
    /// @notice Amount burned so far in `ceilingYear` (credited back to the ceiling).
    uint256 public burnedThisYear;

    error AnnualMintCeilingExceeded(uint256 requested, uint256 remaining);
    error ZeroAddress();

    constructor(address treasury, uint256 initialSupply, uint256 _maxMintBpsPerYear, address admin)
        ERC20("Cloudana Token", "CLD")
    {
        if (treasury == address(0) || admin == address(0)) revert ZeroAddress();
        maxMintBpsPerYear = _maxMintBpsPerYear;
        mintYearStart = block.timestamp;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (initialSupply > 0) _mint(treasury, initialSupply);
        supplyAtYearStart = initialSupply;
    }

    /// @notice Current schedule year of the ceiling (0 for the first 365 days after deployment).
    function currentMintYear() public view returns (uint256) {
        return (block.timestamp - mintYearStart) / YEAR;
    }

    /// @notice Amount still mintable this year under the net ceiling (as of now; a new year re-snapshots supply).
    function mintRemainingThisYear() external view returns (uint256) {
        uint256 y = currentMintYear();
        bool same = y == ceilingYear;
        uint256 allowed = ((same ? supplyAtYearStart : totalSupply()) * maxMintBpsPerYear) / 10_000 + (same ? burnedThisYear : 0);
        uint256 used = same ? mintedThisYear : 0;
        return allowed > used ? allowed - used : 0;
    }

    /// @notice Mint `amount` to `to` (MINTER_ROLE), subject to the annual net ceiling.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _rollYear();
        uint256 allowed = (supplyAtYearStart * maxMintBpsPerYear) / 10_000 + burnedThisYear;
        uint256 used = mintedThisYear;
        if (used + amount > allowed) revert AnnualMintCeilingExceeded(amount, allowed > used ? allowed - used : 0);
        mintedThisYear = used + amount;
        _mint(to, amount);
    }

    function _rollYear() private {
        uint256 y = currentMintYear();
        if (y != ceilingYear) {
            ceilingYear = y;
            supplyAtYearStart = totalSupply();
            mintedThisYear = 0;
            burnedThisYear = 0;
        }
    }

    /// @dev Burns (transfers to address(0)) credit the year's ceiling back.
    function _update(address from, address to, uint256 value) internal override {
        if (to == address(0) && from != address(0)) {
            _rollYear();
            burnedThisYear += value;
        }
        super._update(from, to, value);
    }
}
