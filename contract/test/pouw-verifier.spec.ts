import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { POUWVerifier } from "../typechain-types";

describe("POUWVerifier", function () {
  async function deployPOUWVerifier() {
    const [deployer, orchestrator, provider1, provider2, other] =
      await ethers.getSigners();

    const Factory = await ethers.getContractFactory("POUWVerifier");
    const verifier = await Factory.deploy();
    await verifier.waitForDeployment();

    // Grant ORCHESTRATOR_ROLE to orchestrator signer
    const ORCHESTRATOR_ROLE = await verifier.ORCHESTRATOR_ROLE();
    await verifier.grantRole(ORCHESTRATOR_ROLE, orchestrator.address);

    // Sample certificate data
    const deviceId = ethers.id("device-gpu-01");
    const matrixSize = 64;
    const difficulty = 8;
    const transcriptHash = ethers.keccak256(ethers.toUtf8Bytes("transcript-block-data"));
    const z = ethers.keccak256(ethers.toUtf8Bytes("proof-hash-001"));
    const timestamp = BigInt(Date.now());

    return {
      verifier,
      deployer,
      orchestrator,
      provider1,
      provider2,
      other,
      deviceId,
      matrixSize,
      difficulty,
      transcriptHash,
      z,
      timestamp,
      ORCHESTRATOR_ROLE,
    };
  }

  describe("Certificate submission", function () {
    it("Should submit a certificate with valid data", async function () {
      const {
        verifier,
        orchestrator,
        provider1,
        deviceId,
        matrixSize,
        difficulty,
        transcriptHash,
        z,
        timestamp,
      } = await loadFixture(deployPOUWVerifier);

      await verifier
        .connect(orchestrator)
        .recordCertificate(
          provider1.address,
          deviceId,
          matrixSize,
          difficulty,
          transcriptHash,
          z,
          timestamp
        );

      const cert = await verifier.getCertificate(1);
      expect(cert.provider).to.equal(provider1.address);
      expect(cert.deviceId).to.equal(deviceId);
      expect(cert.matrixSize).to.equal(matrixSize);
      expect(cert.difficulty).to.equal(difficulty);
      expect(cert.transcriptHash).to.equal(transcriptHash);
      expect(cert.z).to.equal(z);
      expect(cert.timestamp).to.equal(timestamp);
      expect(cert.blockNumber).to.be.gt(0);
    });

    it("Should emit CertificateRecorded event", async function () {
      const {
        verifier,
        orchestrator,
        provider1,
        deviceId,
        matrixSize,
        difficulty,
        transcriptHash,
        z,
        timestamp,
      } = await loadFixture(deployPOUWVerifier);

      await expect(
        verifier
          .connect(orchestrator)
          .recordCertificate(
            provider1.address,
            deviceId,
            matrixSize,
            difficulty,
            transcriptHash,
            z,
            timestamp
          )
      )
        .to.emit(verifier, "CertificateRecorded")
        .withArgs(
          1, // first certificate ID
          provider1.address,
          deviceId,
          matrixSize,
          difficulty,
          transcriptHash,
          z,
          (blockNum: bigint) => blockNum > 0n
        );
    });

    it("Should emit MinerRegistered event on first submission", async function () {
      const {
        verifier,
        orchestrator,
        provider1,
        deviceId,
        matrixSize,
        difficulty,
        transcriptHash,
        z,
        timestamp,
      } = await loadFixture(deployPOUWVerifier);

      await expect(
        verifier
          .connect(orchestrator)
          .recordCertificate(
            provider1.address,
            deviceId,
            matrixSize,
            difficulty,
            transcriptHash,
            z,
            timestamp
          )
      )
        .to.emit(verifier, "MinerRegistered")
        .withArgs(provider1.address, deviceId);
    });

    it("Should increment certificate count", async function () {
      const {
        verifier,
        orchestrator,
        provider1,
        deviceId,
        matrixSize,
        difficulty,
        transcriptHash,
        timestamp,
      } = await loadFixture(deployPOUWVerifier);

      expect(await verifier.certificateCount()).to.equal(0);

      const z1 = ethers.keccak256(ethers.toUtf8Bytes("proof-1"));
      await verifier
        .connect(orchestrator)
        .recordCertificate(
          provider1.address, deviceId, matrixSize, difficulty,
          transcriptHash, z1, timestamp
        );
      expect(await verifier.certificateCount()).to.equal(1);

      const z2 = ethers.keccak256(ethers.toUtf8Bytes("proof-2"));
      await verifier
        .connect(orchestrator)
        .recordCertificate(
          provider1.address, deviceId, matrixSize, difficulty,
          transcriptHash, z2, timestamp
        );
      expect(await verifier.certificateCount()).to.equal(2);
    });
  });

  describe("Provider stats", function () {
    it("Should track provider stats (totalCertificates, totalDifficulty)", async function () {
      const {
        verifier,
        orchestrator,
        provider1,
        deviceId,
        matrixSize,
        transcriptHash,
        timestamp,
      } = await loadFixture(deployPOUWVerifier);

      const difficulty1 = 8;
      const difficulty2 = 12;
      const z1 = ethers.keccak256(ethers.toUtf8Bytes("proof-a"));
      const z2 = ethers.keccak256(ethers.toUtf8Bytes("proof-b"));

      await verifier
        .connect(orchestrator)
        .recordCertificate(
          provider1.address, deviceId, matrixSize, difficulty1,
          transcriptHash, z1, timestamp
        );

      await verifier
        .connect(orchestrator)
        .recordCertificate(
          provider1.address, deviceId, matrixSize, difficulty2,
          transcriptHash, z2, timestamp
        );

      const stats = await verifier.getMinerStats(provider1.address);
      expect(stats.totalCertificates).to.equal(2);
      expect(stats.totalDifficulty).to.equal(difficulty1 + difficulty2);
      expect(stats.lastSubmittedBlock).to.be.gt(0);
    });

    it("Should register provider in miners list on first submission", async function () {
      const {
        verifier,
        orchestrator,
        provider1,
        deviceId,
        matrixSize,
        difficulty,
        transcriptHash,
        z,
        timestamp,
      } = await loadFixture(deployPOUWVerifier);

      expect(await verifier.minerCount()).to.equal(0);

      await verifier
        .connect(orchestrator)
        .recordCertificate(
          provider1.address, deviceId, matrixSize, difficulty,
          transcriptHash, z, timestamp
        );

      expect(await verifier.minerCount()).to.equal(1);
      expect(await verifier.miners(0)).to.equal(provider1.address);
    });

    it("Should not duplicate provider in miners list on subsequent submissions", async function () {
      const {
        verifier,
        orchestrator,
        provider1,
        deviceId,
        matrixSize,
        difficulty,
        transcriptHash,
        timestamp,
      } = await loadFixture(deployPOUWVerifier);

      const z1 = ethers.keccak256(ethers.toUtf8Bytes("proof-x"));
      const z2 = ethers.keccak256(ethers.toUtf8Bytes("proof-y"));

      await verifier
        .connect(orchestrator)
        .recordCertificate(
          provider1.address, deviceId, matrixSize, difficulty,
          transcriptHash, z1, timestamp
        );

      await verifier
        .connect(orchestrator)
        .recordCertificate(
          provider1.address, deviceId, matrixSize, difficulty,
          transcriptHash, z2, timestamp
        );

      expect(await verifier.minerCount()).to.equal(1);
    });

    it("Should track multiple providers independently", async function () {
      const {
        verifier,
        orchestrator,
        provider1,
        provider2,
        deviceId,
        matrixSize,
        difficulty,
        transcriptHash,
        timestamp,
      } = await loadFixture(deployPOUWVerifier);

      const z1 = ethers.keccak256(ethers.toUtf8Bytes("proof-p1"));
      const z2 = ethers.keccak256(ethers.toUtf8Bytes("proof-p2"));
      const deviceId2 = ethers.id("device-gpu-02");

      await verifier
        .connect(orchestrator)
        .recordCertificate(
          provider1.address, deviceId, matrixSize, difficulty,
          transcriptHash, z1, timestamp
        );

      await verifier
        .connect(orchestrator)
        .recordCertificate(
          provider2.address, deviceId2, matrixSize, difficulty,
          transcriptHash, z2, timestamp
        );

      expect(await verifier.minerCount()).to.equal(2);

      const stats1 = await verifier.getMinerStats(provider1.address);
      expect(stats1.totalCertificates).to.equal(1);

      const stats2 = await verifier.getMinerStats(provider2.address);
      expect(stats2.totalCertificates).to.equal(1);
    });
  });

  describe("Replay protection", function () {
    it("Should reject duplicate z values (replay protection)", async function () {
      const {
        verifier,
        orchestrator,
        provider1,
        deviceId,
        matrixSize,
        difficulty,
        transcriptHash,
        z,
        timestamp,
      } = await loadFixture(deployPOUWVerifier);

      await verifier
        .connect(orchestrator)
        .recordCertificate(
          provider1.address, deviceId, matrixSize, difficulty,
          transcriptHash, z, timestamp
        );

      await expect(
        verifier
          .connect(orchestrator)
          .recordCertificate(
            provider1.address, deviceId, matrixSize, difficulty,
            transcriptHash, z, timestamp
          )
      ).to.be.revertedWith("Certificate z already recorded (replay)");
    });

    it("Should mark z as used after submission", async function () {
      const {
        verifier,
        orchestrator,
        provider1,
        deviceId,
        matrixSize,
        difficulty,
        transcriptHash,
        z,
        timestamp,
      } = await loadFixture(deployPOUWVerifier);

      expect(await verifier.isZUsed(z)).to.equal(false);

      await verifier
        .connect(orchestrator)
        .recordCertificate(
          provider1.address, deviceId, matrixSize, difficulty,
          transcriptHash, z, timestamp
        );

      expect(await verifier.isZUsed(z)).to.equal(true);
    });
  });

  describe("Access control", function () {
    it("Should require ORCHESTRATOR_ROLE for submission", async function () {
      const {
        verifier,
        orchestrator,
        provider1,
        deviceId,
        matrixSize,
        difficulty,
        transcriptHash,
        z,
        timestamp,
        ORCHESTRATOR_ROLE,
      } = await loadFixture(deployPOUWVerifier);

      // Verify orchestrator has the role
      expect(
        await verifier.hasRole(ORCHESTRATOR_ROLE, orchestrator.address)
      ).to.equal(true);
    });

    it("Should reject unauthorized submissions", async function () {
      const {
        verifier,
        other,
        provider1,
        deviceId,
        matrixSize,
        difficulty,
        transcriptHash,
        z,
        timestamp,
      } = await loadFixture(deployPOUWVerifier);

      await expect(
        verifier
          .connect(other)
          .recordCertificate(
            provider1.address, deviceId, matrixSize, difficulty,
            transcriptHash, z, timestamp
          )
      ).to.be.revertedWithCustomError(verifier, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Validation", function () {
    it("Should reject zero address provider", async function () {
      const {
        verifier,
        orchestrator,
        deviceId,
        matrixSize,
        difficulty,
        transcriptHash,
        z,
        timestamp,
      } = await loadFixture(deployPOUWVerifier);

      await expect(
        verifier
          .connect(orchestrator)
          .recordCertificate(
            ethers.ZeroAddress, deviceId, matrixSize, difficulty,
            transcriptHash, z, timestamp
          )
      ).to.be.revertedWith("Invalid provider address");
    });

    it("Should reject matrix size smaller than 8", async function () {
      const {
        verifier,
        orchestrator,
        provider1,
        deviceId,
        difficulty,
        transcriptHash,
        z,
        timestamp,
      } = await loadFixture(deployPOUWVerifier);

      await expect(
        verifier
          .connect(orchestrator)
          .recordCertificate(
            provider1.address, deviceId, 4, difficulty,
            transcriptHash, z, timestamp
          )
      ).to.be.revertedWith("Matrix size too small");
    });

    it("Should reject difficulty of zero", async function () {
      const {
        verifier,
        orchestrator,
        provider1,
        deviceId,
        matrixSize,
        transcriptHash,
        z,
        timestamp,
      } = await loadFixture(deployPOUWVerifier);

      await expect(
        verifier
          .connect(orchestrator)
          .recordCertificate(
            provider1.address, deviceId, matrixSize, 0,
            transcriptHash, z, timestamp
          )
      ).to.be.revertedWith("Invalid difficulty");
    });

    it("Should reject invalid certificate ID in getCertificate", async function () {
      const { verifier } = await loadFixture(deployPOUWVerifier);

      await expect(verifier.getCertificate(0)).to.be.revertedWith(
        "Invalid certificate ID"
      );

      await expect(verifier.getCertificate(999)).to.be.revertedWith(
        "Invalid certificate ID"
      );
    });
  });
});
