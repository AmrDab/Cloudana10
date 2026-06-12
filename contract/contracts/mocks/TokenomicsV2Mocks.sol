// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../RewardContract_v2_burn.sol";

/// Test-only mock of the CLD token: open mint/burn, minimal ERC20 surface.
/// Lives under mocks/ — never deploy to a public network.
contract MockCLD {
    string public constant name = "Mock CLD";
    string public constant symbol = "mCLD";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function burn(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// Concrete harness so the abstract V2 additions (burn split) can be unit-tested.
contract RewardV2Harness is RewardContractV2Additions {
    mapping(uint256 => uint256) public workloadDeposits;

    constructor(address cld, address _treasury) {
        cldSettlement = ICLDBurnable(cld);
        treasury = _treasury;
    }

    function fundWorkload(uint256 workloadId, uint256 amount) external returns (uint256) {
        return _fundWorkloadV2(workloadId, amount, workloadDeposits);
    }
}
