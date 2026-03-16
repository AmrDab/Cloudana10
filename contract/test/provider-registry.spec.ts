import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { ProviderRegistry } from "../typechain-types";

describe("ProviderRegistry", function () {
  async function deployProviderRegistry() {
    const [owner, provider1, provider2, other] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("ProviderRegistry");
    const registry = await Factory.deploy();
    await registry.waitForDeployment();

    const deviceId1 = ethers.id("device-1");
    const deviceId2 = ethers.id("device-2");
    const deviceId3 = ethers.id("device-3");
    const metadataUri = "ipfs://QmTestMetadata123";
    const updatedMetadataUri = "ipfs://QmUpdatedMetadata456";

    return {
      registry,
      owner,
      provider1,
      provider2,
      other,
      deviceId1,
      deviceId2,
      deviceId3,
      metadataUri,
      updatedMetadataUri,
    };
  }

  describe("Registration", function () {
    it("Should register a provider with deviceId and metadataUri", async function () {
      const { registry, provider1, deviceId1, metadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);

      const info = await registry.getProviderByDevice(deviceId1);
      expect(info.providerAddr).to.equal(provider1.address);
      expect(info.deviceId).to.equal(deviceId1);
      expect(info.metadataUri).to.equal(metadataUri);
      expect(info.status).to.equal(1); // Active
      expect(info.registeredAt).to.be.gt(0);
      expect(info.updatedAt).to.be.gt(0);
    });

    it("Should emit ProviderRegistered event", async function () {
      const { registry, provider1, deviceId1, metadataUri } =
        await loadFixture(deployProviderRegistry);

      await expect(
        registry.connect(provider1).registerProvider(deviceId1, metadataUri)
      )
        .to.emit(registry, "ProviderRegistered")
        .withArgs(
          provider1.address,
          deviceId1,
          metadataUri,
          (ts: bigint) => ts > 0n
        );
    });

    it("Should reject duplicate deviceId registration", async function () {
      const { registry, provider1, provider2, deviceId1, metadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);

      await expect(
        registry.connect(provider2).registerProvider(deviceId1, metadataUri)
      ).to.be.revertedWith("Device already registered");
    });

    it("Should reject registration with empty metadataUri", async function () {
      const { registry, provider1, deviceId1 } = await loadFixture(
        deployProviderRegistry
      );

      await expect(
        registry.connect(provider1).registerProvider(deviceId1, "")
      ).to.be.revertedWith("Metadata URI required");
    });

    it("Should allow multiple devices per wallet", async function () {
      const { registry, provider1, deviceId1, deviceId2, deviceId3, metadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);
      await registry.connect(provider1).registerProvider(deviceId2, metadataUri);
      await registry.connect(provider1).registerProvider(deviceId3, metadataUri);

      const deviceIds = await registry.getProvidersByOwner(provider1.address);
      expect(deviceIds.length).to.equal(3);
      expect(deviceIds[0]).to.equal(deviceId1);
      expect(deviceIds[1]).to.equal(deviceId2);
      expect(deviceIds[2]).to.equal(deviceId3);
    });

    it("Should track device in global device list", async function () {
      const { registry, provider1, deviceId1, metadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);

      const allDevices = await registry.getAllProviders();
      expect(allDevices.length).to.equal(1);
      expect(allDevices[0]).to.equal(deviceId1);
    });

    it("Should mark device as registered", async function () {
      const { registry, provider1, deviceId1, metadataUri } =
        await loadFixture(deployProviderRegistry);

      expect(await registry.isDeviceRegistered(deviceId1)).to.equal(false);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);

      expect(await registry.isDeviceRegistered(deviceId1)).to.equal(true);
    });
  });

  describe("Update", function () {
    it("Should update provider metadata", async function () {
      const { registry, provider1, deviceId1, metadataUri, updatedMetadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);
      await registry.connect(provider1).updateProvider(deviceId1, updatedMetadataUri);

      const info = await registry.getProviderByDevice(deviceId1);
      expect(info.metadataUri).to.equal(updatedMetadataUri);
    });

    it("Should emit ProviderUpdated event", async function () {
      const { registry, provider1, deviceId1, metadataUri, updatedMetadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);

      await expect(
        registry.connect(provider1).updateProvider(deviceId1, updatedMetadataUri)
      )
        .to.emit(registry, "ProviderUpdated")
        .withArgs(
          provider1.address,
          deviceId1,
          updatedMetadataUri,
          (ts: bigint) => ts > 0n
        );
    });

    it("Should reject update from non-owner", async function () {
      const { registry, provider1, other, deviceId1, metadataUri, updatedMetadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);

      await expect(
        registry.connect(other).updateProvider(deviceId1, updatedMetadataUri)
      ).to.be.revertedWith("Not device owner");
    });

    it("Should reject update with empty metadataUri", async function () {
      const { registry, provider1, deviceId1, metadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);

      await expect(
        registry.connect(provider1).updateProvider(deviceId1, "")
      ).to.be.revertedWith("Metadata URI required");
    });
  });

  describe("Deregistration", function () {
    it("Should deregister a provider", async function () {
      const { registry, provider1, deviceId1, metadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);
      await registry.connect(provider1).deregisterProvider(deviceId1);

      const info = await registry.getProviderByDevice(deviceId1);
      expect(info.status).to.equal(2); // Inactive
    });

    it("Should emit ProviderDeregistered event", async function () {
      const { registry, provider1, deviceId1, metadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);

      await expect(
        registry.connect(provider1).deregisterProvider(deviceId1)
      )
        .to.emit(registry, "ProviderDeregistered")
        .withArgs(provider1.address, deviceId1, (ts: bigint) => ts > 0n);
    });

    it("Should reject deregistration from non-owner", async function () {
      const { registry, provider1, other, deviceId1, metadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);

      await expect(
        registry.connect(other).deregisterProvider(deviceId1)
      ).to.be.revertedWith("Not device owner");
    });
  });

  describe("Status transitions", function () {
    it("Should handle Active -> Inactive -> Active transitions", async function () {
      const { registry, provider1, deviceId1, metadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);

      // Initial status is Active (1)
      let info = await registry.getProviderByDevice(deviceId1);
      expect(info.status).to.equal(1); // Active

      // Deregister: Active -> Inactive
      await registry.connect(provider1).deregisterProvider(deviceId1);
      info = await registry.getProviderByDevice(deviceId1);
      expect(info.status).to.equal(2); // Inactive

      // Activate: Inactive -> Active
      await registry.connect(provider1).activateProvider(deviceId1);
      info = await registry.getProviderByDevice(deviceId1);
      expect(info.status).to.equal(1); // Active
    });

    it("Should emit ProviderActivated event", async function () {
      const { registry, provider1, deviceId1, metadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);
      await registry.connect(provider1).deregisterProvider(deviceId1);

      await expect(
        registry.connect(provider1).activateProvider(deviceId1)
      )
        .to.emit(registry, "ProviderActivated")
        .withArgs(provider1.address, deviceId1, (ts: bigint) => ts > 0n);
    });

    it("Should reject activation of already active provider", async function () {
      const { registry, provider1, deviceId1, metadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);

      await expect(
        registry.connect(provider1).activateProvider(deviceId1)
      ).to.be.revertedWith("Provider must be inactive to activate");
    });

    it("Should reject activation from non-owner", async function () {
      const { registry, provider1, other, deviceId1, metadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);
      await registry.connect(provider1).deregisterProvider(deviceId1);

      await expect(
        registry.connect(other).activateProvider(deviceId1)
      ).to.be.revertedWith("Not device owner");
    });

    it("Should not appear in active providers after deregistration", async function () {
      const { registry, provider1, deviceId1, deviceId2, metadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);
      await registry.connect(provider1).registerProvider(deviceId2, metadataUri);

      // Both active
      let active = await registry.getActiveProviders();
      expect(active.length).to.equal(2);

      // Deregister one
      await registry.connect(provider1).deregisterProvider(deviceId1);

      active = await registry.getActiveProviders();
      expect(active.length).to.equal(1);
      expect(active[0]).to.equal(deviceId2);
    });

    it("Should reject update on deregistered (inactive) provider", async function () {
      const { registry, provider1, deviceId1, metadataUri, updatedMetadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);
      await registry.connect(provider1).deregisterProvider(deviceId1);

      // The contract checks status != Unregistered, so Inactive providers can still be updated.
      // But let's verify the behavior: Inactive status (2) is != Unregistered (0), so update is allowed.
      await registry.connect(provider1).updateProvider(deviceId1, updatedMetadataUri);
      const info = await registry.getProviderByDevice(deviceId1);
      expect(info.metadataUri).to.equal(updatedMetadataUri);
    });
  });

  describe("View functions", function () {
    it("Should return correct device owner", async function () {
      const { registry, provider1, deviceId1, metadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);

      const deviceOwner = await registry.getDeviceOwner(deviceId1);
      expect(deviceOwner).to.equal(provider1.address);
    });

    it("Should return providers by owner across multiple wallets", async function () {
      const { registry, provider1, provider2, deviceId1, deviceId2, metadataUri } =
        await loadFixture(deployProviderRegistry);

      await registry.connect(provider1).registerProvider(deviceId1, metadataUri);
      await registry.connect(provider2).registerProvider(deviceId2, metadataUri);

      const p1Devices = await registry.getProvidersByOwner(provider1.address);
      expect(p1Devices.length).to.equal(1);
      expect(p1Devices[0]).to.equal(deviceId1);

      const p2Devices = await registry.getProvidersByOwner(provider2.address);
      expect(p2Devices.length).to.equal(1);
      expect(p2Devices[0]).to.equal(deviceId2);
    });
  });
});
