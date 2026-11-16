// Machines (docs/WORKSTATIONS.md §10): sizes, the spec a machine is rented with, and how to connect. Pure, so it is
// unit-tested (model.test.ts); the form and the list live beside it.
import type { TrustTier, WorkstationSpec } from "@/components/console/data";

/** CPU sizes (GPU boxes are workstations). The container's own disk is fixed; the home directory is the volume. */
export const SIZES = {
  S: { cpu: 1000, memMb: 2 * 1024 },
  M: { cpu: 2000, memMb: 4 * 1024 },
  L: { cpu: 4000, memMb: 8 * 1024 },
} as const;
export type Size = keyof typeof SIZES;
/** The root filesystem (packages, /tmp): the container's writable layer, not encrypted. */
export const ROOT_DISK_MB = 10 * 1024;
/** The encrypted home volume, as the API allows it for machines. */
export const VOLUME_GB = { min: 10, max: 100 } as const;
export const MACHINE_TEMPLATE_ID = "machine-ubuntu";
/** The login: root of the box, inside the gVisor sandbox (`cloudana`, uid 1000, is the unprivileged account). */
export const MACHINE_USER = "root";
export const MACHINE_HOME = "/root";

/** A machine is a workstation running the Cloudana machine image (any version). */
export const isMachineImage = (image: string | null | undefined) => !!image && /^ghcr\.io\/amrdab\/cloudana-machine:\d+\.\d+\.\d+$/.test(image);
export const isMachine = (w: { spec: { image?: string } }) => isMachineImage(w.spec.image);

/** How to reach a machine: through the relay with the CLI (no public IP on the provider's side). */
export const connectCommand = (id: string) => `cloudana ssh ${id}`;

export type MachineDraft = { image: string; size: Size; hours: number; publicKey: string; volumeGb: number; keepDays: number; trust: TrustTier };

/** The workstation spec a machine is created with (the API also makes its volume encrypted). */
export function machineSpec(d: MachineDraft): WorkstationSpec {
  return {
    image: d.image,
    ports: [{ container: 22, protocol: "tcp" }],
    ...SIZES[d.size],
    storageMb: ROOT_DISK_MB,
    gpu: { count: 0 },
    tier: "on-demand",
    maxHours: Math.round(d.hours),
    access: { ssh: { publicKey: d.publicKey.trim(), user: MACHINE_USER } },
    volume: { sizeGb: d.volumeGb, keepDays: d.keepDays, encrypted: true },
    workdir: MACHINE_HOME,
    sshPort: 22,
    trust: d.trust,
  };
}

const SSH_KEY = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)) [A-Za-z0-9+/]+={0,3}( [^\r\n]*)?$/;

/** The first thing wrong with a draft, in plain words (null = ready). */
export function draftError(d: Omit<MachineDraft, "image" | "trust"> & { name: string }): string | null {
  const key = d.publicKey.trim();
  if (!d.name.trim()) return "Name is required.";
  if (d.name.trim().length > 40) return "Name: 40 characters at most.";
  if (!key) return "Paste your SSH public key: it is the only way in.";
  if (!SSH_KEY.test(key)) return "A public key starts with ssh-ed25519, ssh-rsa or ecdsa-sha2-… followed by the key.";
  if (!Number.isFinite(d.hours) || d.hours < 1 || d.hours > 720) return "Duration is 1 hour to 30 days.";
  if (!Number.isInteger(d.volumeGb) || d.volumeGb < VOLUME_GB.min || d.volumeGb > VOLUME_GB.max) return `The home volume is ${VOLUME_GB.min}–${VOLUME_GB.max} GB.`;
  if (!Number.isInteger(d.keepDays) || d.keepDays < 0 || d.keepDays > 30) return "Keep the volume 0–30 days.";
  return null;
}
