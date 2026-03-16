import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { WorkloadRegistry } from "../typechain-types";

describe("WorkloadRegistry", function () {
  async function deployWorkloadRegistry() {
    const [deployer, orchestrator, workloadOwner, provider, other] =
      await ethers.getSigners();

    const Factory = await ethers.getContractFactory("WorkloadRegistry");
    const registry = await Factory.deploy();
    await registry.waitForDeployment();

    // Grant ORCHESTRATOR_ROLE to orchestrator signer
    const ORCHESTRATOR_ROLE = await registry.ORCHESTRATOR_ROLE();
    await registry.grantRole(ORCHESTRATOR_ROLE, orchestrator.address);

    const metadataUri = "ipfs://QmWorkloadManifest123";
    const updatedMetadataUri = "ipfs://QmWorkloadManifestUpdated456";

    return {
      registry,
      deployer,
      orchestrator,
      workloadOwner,
      provider,
      other,
      metadataUri,
      updatedMetadataUri,
      ORCHESTRATOR_ROLE,
    };
  }

  describe("Registration", function () {
    it("Should register a workload with metadataUri", async function () {
      const { registry, workloadOwner, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      const tx = await registry
        .connect(workloadOwner)
        .registerWorkload(metadataUri);
      const receipt = await tx.wait();

      const workload = await registry.getWorkload(0);
      expect(workload.id).to.equal(0);
      expect(workload.owner).to.equal(workloadOwner.address);
      expect(workload.metadataUri).to.equal(metadataUri);
      expect(workload.status).to.equal(1); // Active
      expect(workload.registeredAt).to.be.gt(0);
      expect(workload.placementProvider).to.equal(ethers.ZeroAddress);
      expect(workload.placementInstanceId).to.equal(0);
    });

    it("Should emit WorkloadRegistered event", async function () {
      const { registry, workloadOwner, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await expect(
        registry.connect(workloadOwner).registerWorkload(metadataUri)
      )
        .to.emit(registry, "WorkloadRegistered")
        .withArgs(0, workloadOwner.address, metadataUri, (ts: bigint) => ts > 0n);
    });

    it("Should reject registration with empty metadataUri", async function () {
      const { registry, workloadOwner } = await loadFixture(
        deployWorkloadRegistry
      );

      await expect(
        registry.connect(workloadOwner).registerWorkload("")
      ).to.be.revertedWith("Metadata URI required");
    });

    it("Should auto-increment workload IDs", async function () {
      const { registry, workloadOwner, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry.connect(workloadOwner).registerWorkload(metadataUri);

      expect(await registry.getWorkloadCount()).to.equal(3);

      const w0 = await registry.getWorkload(0);
      const w1 = await registry.getWorkload(1);
      const w2 = await registry.getWorkload(2);

      expect(w0.id).to.equal(0);
      expect(w1.id).to.equal(1);
      expect(w2.id).to.equal(2);
    });

    it("Should track workloads per owner", async function () {
      const { registry, workloadOwner, other, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry.connect(other).registerWorkload(metadataUri);

      const ownerWorkloads = await registry.getWorkloadsByOwner(
        workloadOwner.address
      );
      expect(ownerWorkloads.length).to.equal(2);

      const otherWorkloads = await registry.getWorkloadsByOwner(other.address);
      expect(otherWorkloads.length).to.equal(1);
    });
  });

  describe("Update", function () {
    it("Should update workload metadata", async function () {
      const { registry, workloadOwner, metadataUri, updatedMetadataUri } =
        await loadFixture(deployWorkloadRegistry);

      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry
        .connect(workloadOwner)
        .updateWorkload(0, updatedMetadataUri);

      const workload = await registry.getWorkload(0);
      expect(workload.metadataUri).to.equal(updatedMetadataUri);
    });

    it("Should emit WorkloadUpdated event", async function () {
      const { registry, workloadOwner, metadataUri, updatedMetadataUri } =
        await loadFixture(deployWorkloadRegistry);

      await registry.connect(workloadOwner).registerWorkload(metadataUri);

      await expect(
        registry.connect(workloadOwner).updateWorkload(0, updatedMetadataUri)
      )
        .to.emit(registry, "WorkloadUpdated")
        .withArgs(0, updatedMetadataUri, (ts: bigint) => ts > 0n);
    });

    it("Should reject update from non-owner", async function () {
      const { registry, workloadOwner, other, metadataUri, updatedMetadataUri } =
        await loadFixture(deployWorkloadRegistry);

      await registry.connect(workloadOwner).registerWorkload(metadataUri);

      await expect(
        registry.connect(other).updateWorkload(0, updatedMetadataUri)
      ).to.be.revertedWith("Not workload owner");
    });

    it("Should reject update with empty metadataUri", async function () {
      const { registry, workloadOwner, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);

      await expect(
        registry.connect(workloadOwner).updateWorkload(0, "")
      ).to.be.revertedWith("Metadata URI required");
    });

    it("Should reject update on deregistered workload", async function () {
      const { registry, workloadOwner, metadataUri, updatedMetadataUri } =
        await loadFixture(deployWorkloadRegistry);

      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry.connect(workloadOwner).deregisterWorkload(0);

      await expect(
        registry.connect(workloadOwner).updateWorkload(0, updatedMetadataUri)
      ).to.be.revertedWith("Workload is deregistered");
    });
  });

  describe("Deregistration", function () {
    it("Should deregister a workload", async function () {
      const { registry, workloadOwner, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry.connect(workloadOwner).deregisterWorkload(0);

      const workload = await registry.getWorkload(0);
      expect(workload.status).to.equal(0); // Inactive
    });

    it("Should emit WorkloadDeregistered event", async function () {
      const { registry, workloadOwner, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);

      await expect(registry.connect(workloadOwner).deregisterWorkload(0))
        .to.emit(registry, "WorkloadDeregistered")
        .withArgs(0, workloadOwner.address, (ts: bigint) => ts > 0n);
    });

    it("Should reject deregistration from non-owner", async function () {
      const { registry, workloadOwner, other, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);

      await expect(
        registry.connect(other).deregisterWorkload(0)
      ).to.be.revertedWith("Not workload owner");
    });
  });

  describe("Activate/Deactivate", function () {
    it("Should activate a deregistered workload", async function () {
      const { registry, workloadOwner, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry.connect(workloadOwner).deregisterWorkload(0);

      let workload = await registry.getWorkload(0);
      expect(workload.status).to.equal(0); // Inactive

      await registry.connect(workloadOwner).activateWorkload(0);

      workload = await registry.getWorkload(0);
      expect(workload.status).to.equal(1); // Active
    });

    it("Should emit WorkloadActivated event", async function () {
      const { registry, workloadOwner, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry.connect(workloadOwner).deregisterWorkload(0);

      await expect(registry.connect(workloadOwner).activateWorkload(0))
        .to.emit(registry, "WorkloadActivated")
        .withArgs(0, workloadOwner.address, (ts: bigint) => ts > 0n);
    });

    it("Should reject activation of already active workload", async function () {
      const { registry, workloadOwner, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);

      await expect(
        registry.connect(workloadOwner).activateWorkload(0)
      ).to.be.revertedWith("Workload must be inactive to activate");
    });

    it("Should reject activation from non-owner", async function () {
      const { registry, workloadOwner, other, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry.connect(workloadOwner).deregisterWorkload(0);

      await expect(
        registry.connect(other).activateWorkload(0)
      ).to.be.revertedWith("Not workload owner");
    });

    it("Should not appear in active workloads after deregistration", async function () {
      const { registry, workloadOwner, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry.connect(workloadOwner).registerWorkload(metadataUri);

      let active = await registry.getActiveWorkloadIds();
      expect(active.length).to.equal(2);

      await registry.connect(workloadOwner).deregisterWorkload(0);

      active = await registry.getActiveWorkloadIds();
      expect(active.length).to.equal(1);
      expect(active[0]).to.equal(1);
    });
  });

  describe("Placement", function () {
    it("Should record placement (requires ORCHESTRATOR_ROLE)", async function () {
      const { registry, workloadOwner, orchestrator, provider, metadataUri } =
        await loadFixture(deployWorkloadRegistry);

      await registry.connect(workloadOwner).registerWorkload(metadataUri);

      const instanceId = 42;
      await registry
        .connect(orchestrator)
        .recordPlacement(0, provider.address, instanceId);

      const workload = await registry.getWorkload(0);
      expect(workload.placementProvider).to.equal(provider.address);
      expect(workload.placementInstanceId).to.equal(instanceId);
    });

    it("Should emit WorkloadPlaced event", async function () {
      const { registry, workloadOwner, orchestrator, provider, metadataUri } =
        await loadFixture(deployWorkloadRegistry);

      await registry.connect(workloadOwner).registerWorkload(metadataUri);

      const instanceId = 42;
      await expect(
        registry
          .connect(orchestrator)
          .recordPlacement(0, provider.address, instanceId)
      )
        .to.emit(registry, "WorkloadPlaced")
        .withArgs(0, provider.address, instanceId, (ts: bigint) => ts > 0n);
    });

    it("Should reject unauthorized placement", async function () {
      const { registry, workloadOwner, other, provider, metadataUri } =
        await loadFixture(deployWorkloadRegistry);

      await registry.connect(workloadOwner).registerWorkload(metadataUri);

      await expect(
        registry.connect(other).recordPlacement(0, provider.address, 1)
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("Should reject placement for non-existent workload", async function () {
      const { registry, orchestrator, provider } = await loadFixture(
        deployWorkloadRegistry
      );

      await expect(
        registry.connect(orchestrator).recordPlacement(999, provider.address, 1)
      ).to.be.revertedWith("Workload does not exist");
    });

    it("Should reject placement with zero address provider", async function () {
      const { registry, workloadOwner, orchestrator, metadataUri } =
        await loadFixture(deployWorkloadRegistry);

      await registry.connect(workloadOwner).registerWorkload(metadataUri);

      await expect(
        registry
          .connect(orchestrator)
          .recordPlacement(0, ethers.ZeroAddress, 1)
      ).to.be.revertedWith("Invalid provider");
    });

    it("Should reject placement on inactive workload", async function () {
      const { registry, workloadOwner, orchestrator, provider, metadataUri } =
        await loadFixture(deployWorkloadRegistry);

      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry.connect(workloadOwner).deregisterWorkload(0);

      await expect(
        registry
          .connect(orchestrator)
          .recordPlacement(0, provider.address, 1)
      ).to.be.revertedWith("Workload must be active");
    });
  });

  describe("Delete", function () {
    it("Should delete an inactive workload", async function () {
      const { registry, workloadOwner, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry.connect(workloadOwner).deregisterWorkload(0);
      await registry.connect(workloadOwner).deleteWorkload(0);

      // After deletion, the workload data is zeroed out
      const workload = await registry.getWorkload(0);
      expect(workload.owner).to.equal(ethers.ZeroAddress);
    });

    it("Should emit WorkloadDeleted event", async function () {
      const { registry, workloadOwner, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry.connect(workloadOwner).deregisterWorkload(0);

      await expect(registry.connect(workloadOwner).deleteWorkload(0))
        .to.emit(registry, "WorkloadDeleted")
        .withArgs(0, workloadOwner.address, (ts: bigint) => ts > 0n);
    });

    it("Should reject deletion of active workload", async function () {
      const { registry, workloadOwner, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);

      await expect(
        registry.connect(workloadOwner).deleteWorkload(0)
      ).to.be.revertedWith("Workload must be inactive to delete");
    });

    it("Should reject deletion from non-owner", async function () {
      const { registry, workloadOwner, other, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry.connect(workloadOwner).deregisterWorkload(0);

      await expect(
        registry.connect(other).deleteWorkload(0)
      ).to.be.revertedWith("Not workload owner");
    });
  });

  describe("View functions", function () {
    it("Should check workload existence", async function () {
      const { registry, workloadOwner, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      expect(await registry.workloadExists(0)).to.equal(false);

      await registry.connect(workloadOwner).registerWorkload(metadataUri);

      expect(await registry.workloadExists(0)).to.equal(true);
    });

    it("Should return workloads via getUserWorkloads alias", async function () {
      const { registry, workloadOwner, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry.connect(workloadOwner).registerWorkload(metadataUri);

      const ids = await registry.getUserWorkloads(workloadOwner.address);
      expect(ids.length).to.equal(2);
    });

    it("Should batch get workloads", async function () {
      const { registry, workloadOwner, metadataUri } = await loadFixture(
        deployWorkloadRegistry
      );

      await registry.connect(workloadOwner).registerWorkload(metadataUri);
      await registry
        .connect(workloadOwner)
        .registerWorkload("ipfs://QmSecondWorkload");

      const batch = await registry.getWorkloadsBatch([0, 1]);
      expect(batch.length).to.equal(2);
      expect(batch[0].metadataUri).to.equal(metadataUri);
      expect(batch[1].metadataUri).to.equal("ipfs://QmSecondWorkload");
    });
  });
});
