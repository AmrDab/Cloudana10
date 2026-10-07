// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @dev Test-only token: on mint / burn / transferFrom it re-enters `target` with `attackData` and records
 *      whether that nested call succeeded. Used to show CloudanaSettlementV2's external calls are guarded.
 */
contract ReentrantCLDMock is ERC20 {
    address public target;
    bytes public attackData;
    bool public attacked;
    bool public reentrySucceeded;
    bytes public reentryError;

    constructor() ERC20("Mock", "MCK") {}

    function setAttack(address _target, bytes calldata data) external {
        target = _target;
        attackData = data;
        attacked = false;
        reentrySucceeded = false;
    }

    function fund(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _reenter() internal {
        if (target == address(0) || attacked) return;
        attacked = true;
        (bool ok, bytes memory err) = target.call(attackData);
        reentrySucceeded = ok;
        reentryError = err;
    }

    function mint(address to, uint256 amount) external {
        _reenter();
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _reenter();
        _burn(msg.sender, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        _reenter();
        return super.transferFrom(from, to, amount);
    }
}
