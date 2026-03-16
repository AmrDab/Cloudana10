// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CLDFaucet
 * @notice Testnet faucet for distributing CLD tokens to developers and testers.
 * @dev Rate-limited: one drip per address per cooldown period.
 */
contract CLDFaucet is Ownable {
    IERC20 public immutable cldToken;

    uint256 public dripAmount = 1000 * 1e18;    // 1000 CLD per drip
    uint256 public cooldownTime = 24 hours;      // Once per day

    mapping(address => uint256) public lastDrip;

    event Drip(address indexed recipient, uint256 amount);
    event DripAmountUpdated(uint256 newAmount);
    event CooldownUpdated(uint256 newCooldown);
    event FaucetFunded(address indexed funder, uint256 amount);

    constructor(address _cldToken) Ownable(msg.sender) {
        cldToken = IERC20(_cldToken);
    }

    /**
     * @notice Request CLD tokens from the faucet.
     */
    function drip() external {
        require(
            block.timestamp >= lastDrip[msg.sender] + cooldownTime,
            "CLDFaucet: cooldown not elapsed"
        );
        require(
            cldToken.balanceOf(address(this)) >= dripAmount,
            "CLDFaucet: insufficient faucet balance"
        );

        lastDrip[msg.sender] = block.timestamp;
        require(cldToken.transfer(msg.sender, dripAmount), "CLDFaucet: transfer failed");

        emit Drip(msg.sender, dripAmount);
    }

    /**
     * @notice Check if an address can drip.
     */
    function canDrip(address addr) external view returns (bool) {
        return block.timestamp >= lastDrip[addr] + cooldownTime;
    }

    /**
     * @notice Time remaining until address can drip again.
     */
    function timeUntilDrip(address addr) external view returns (uint256) {
        uint256 nextDrip = lastDrip[addr] + cooldownTime;
        if (block.timestamp >= nextDrip) return 0;
        return nextDrip - block.timestamp;
    }

    // --- Owner functions ---

    function setDripAmount(uint256 _amount) external onlyOwner {
        dripAmount = _amount;
        emit DripAmountUpdated(_amount);
    }

    function setCooldown(uint256 _cooldown) external onlyOwner {
        cooldownTime = _cooldown;
        emit CooldownUpdated(_cooldown);
    }

    /**
     * @notice Withdraw remaining tokens (owner only).
     */
    function withdraw(uint256 amount) external onlyOwner {
        require(cldToken.transfer(msg.sender, amount), "CLDFaucet: withdraw failed");
    }
}
