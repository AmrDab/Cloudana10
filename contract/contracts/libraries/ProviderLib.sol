// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ProviderLib
 * @dev Minimal on-chain provider state. Full device spec lives on IPFS; chain stores only metadata URI (CID or gateway URL).
 */
library ProviderLib {
    struct Provider {
        address providerAddr;
        bytes32 deviceId;
        string metadataUri;   // IPFS CID or gateway URL (e.g. https://gateway.pinata.cloud/ipfs/Qm...)
        ProviderStatus status;
        uint256 registeredAt;
        uint256 updatedAt;
    }

    enum ProviderStatus {
        Unregistered,
        Active,
        Inactive,
        Suspended
    }
}
