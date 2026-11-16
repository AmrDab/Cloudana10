import { describe, expect, it } from "vitest";
import { connectCommand, draftError, isMachine, isMachineImage, machineSpec, SIZES } from "./model";

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq0 me@laptop";
const IMAGE = "ghcr.io/amrdab/cloudana-machine:1.0.0";
const ok = { name: "box", publicKey: KEY, hours: 6, volumeGb: 20, keepDays: 3, size: "M" as const };

describe("machines", () => {
  it("builds the spec the API expects: CPU, SSH as root, an encrypted /root volume", () => {
    const s = machineSpec({ image: IMAGE, size: "L", hours: 6.4, publicKey: ` ${KEY}\n`, volumeGb: 20, keepDays: 3, trust: "verified" });
    expect(s).toMatchObject({
      image: IMAGE,
      ports: [{ container: 22 }],
      cpu: 4000,
      memMb: 8192,
      gpu: { count: 0 },
      tier: "on-demand",
      maxHours: 6,
      access: { ssh: { publicKey: KEY, user: "root" } },
      volume: { sizeGb: 20, keepDays: 3, encrypted: true },
      workdir: "/root",
      trust: "verified",
    });
    expect(s.access.web).toBeUndefined();
    expect(Object.values(SIZES).map((z) => [z.cpu / 1000, z.memMb / 1024])).toEqual([[1, 2], [2, 4], [4, 8]]);
  });

  it("checks the draft in plain words", () => {
    expect(draftError(ok)).toBeNull();
    expect(draftError({ ...ok, publicKey: "" })).toMatch(/only way in/);
    expect(draftError({ ...ok, publicKey: "hello" })).toMatch(/ssh-ed25519/);
    expect(draftError({ ...ok, volumeGb: 9 })).toMatch(/10–100 GB/);
    expect(draftError({ ...ok, volumeGb: 101 })).toMatch(/10–100 GB/);
    expect(draftError({ ...ok, hours: 0 })).toMatch(/Duration/);
    expect(draftError({ ...ok, name: " " })).toMatch(/Name/);
  });

  it("tells machines from workstations and connects through the relay", () => {
    expect(isMachineImage(IMAGE)).toBe(true);
    expect(isMachineImage("ghcr.io/amrdab/cloudana-machine:latest")).toBe(false);
    expect(isMachine({ spec: { image: "codercom/code-server:latest" } })).toBe(false);
    expect(connectCommand("0c1d")).toBe("cloudana ssh 0c1d");
  });
});
