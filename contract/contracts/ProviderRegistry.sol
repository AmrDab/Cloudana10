// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./CLDToken.sol";

/**
 * @title ProviderRegistry
 * @dev Registry for compute providers in Cloudana MVP
 */
contract ProviderRegistry is AccessControl {
    CLDToken public immutable cldToken;

    struct Provider {
        address owner;
        bool active;
        bytes32 metaHash;
        uint64 createdAt;
    }

    mapping(address => Provider) public providers;

    error ProviderNotRegistered(address provider);
    error ProviderAlreadyRegistered(address provider);
    error NotProviderOwner(address caller, address owner);
    error InvalidBurnAmount();

    event ProviderRegistered(
        address indexed owner,
        bytes32 indexed metaHash,
        uint256 burnedAmount
    );
    event ProviderStatusChanged(address indexed owner, bool active);
    event ProviderMetaUpdated(address indexed owner, bytes32 indexed metaHash);

    constructor(address _cldToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        cldToken = CLDToken(_cldToken);
    }

    /**
     * @dev Register a new provider with optional metadata hash
     * @param metaHash Hash of provider metadata (IPFS, etc.)
     */
    function registerProvider(bytes32 metaHash) external {
        if (providers[msg.sender].owner != address(0)) {
            revert ProviderAlreadyRegistered(msg.sender);
        }

        providers[msg.sender] = Provider({
            owner: msg.sender,
            active: true,
            metaHash: metaHash,
            createdAt: uint64(block.timestamp)
        });

        emit ProviderRegistered(msg.sender, metaHash, 0);
    }

    /**
     * @dev Register a provider and burn CLD tokens (requires approval)
     * @param metaHash Hash of provider metadata
     * @param burnAmount Amount of CLD tokens to burn
     */
    function registerProviderWithBurn(
        bytes32 metaHash,
        uint256 burnAmount
    ) external {
        if (providers[msg.sender].owner != address(0)) {
            revert ProviderAlreadyRegistered(msg.sender);
        }

        if (burnAmount > 0) {
            cldToken.burnFrom(msg.sender, burnAmount);
        }

        providers[msg.sender] = Provider({
            owner: msg.sender,
            active: true,
            metaHash: metaHash,
            createdAt: uint64(block.timestamp)
        });

        emit ProviderRegistered(msg.sender, metaHash, burnAmount);
    }

    /**
     * @dev Set provider active status (only owner or admin)
     * @param active New active status
     */
    function setProviderActive(bool active) external {
        Provider storage provider = providers[msg.sender];
        if (provider.owner == address(0)) {
            revert ProviderNotRegistered(msg.sender);
        }

        // Allow owner or admin to change status
        if (msg.sender != provider.owner && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotProviderOwner(msg.sender, provider.owner);
        }

        provider.active = active;
        emit ProviderStatusChanged(msg.sender, active);
    }

    /**
     * @dev Update provider metadata hash (only owner)
     * @param metaHash New metadata hash
     */
    function updateMetaHash(bytes32 metaHash) external {
        Provider storage provider = providers[msg.sender];
        if (provider.owner == address(0)) {
            revert ProviderNotRegistered(msg.sender);
        }
        if (msg.sender != provider.owner) {
            revert NotProviderOwner(msg.sender, provider.owner);
        }

        provider.metaHash = metaHash;
        emit ProviderMetaUpdated(msg.sender, metaHash);
    }

    /**
     * @dev Get provider information
     * @param owner Provider owner address
     * @return Provider struct
     */
    function getProvider(address owner) external view returns (Provider memory) {
        return providers[owner];
    }
}

