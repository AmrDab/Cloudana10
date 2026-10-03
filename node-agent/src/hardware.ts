import { execFileSync } from "node:child_process";
import os from "node:os";

export interface GpuInfo {
  name: string;
  vramGB: number;
}

export interface Manifest {
  cpuThreads: number;
  ramGB: number;
  os: string;
  gpus: GpuInfo[];
}

export function detectHardware(): Manifest {
  return {
    cpuThreads: os.cpus().length,
    ramGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    os: os.platform(),
    gpus: detectGpus(),
  };
}

/**
 * GPUs from `nvidia-smi` (3 s timeout). [] when nvidia-smi is missing, fails or finds none — not an error.
 * A non-empty list is also the "nvidia-smi works" half of the `gpu` capability.
 */
export function detectGpus(): GpuInfo[] {
  try {
    const out = execFileSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"], {
      encoding: "utf8",
      timeout: 3000,
      windowsHide: true,
    });
    return parseNvidiaSmi(out);
  } catch {
    return [];
  }
}

/** Parse `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader` ("NVIDIA A100, 81920 MiB" per line). */
export function parseNvidiaSmi(out: string): GpuInfo[] {
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.lastIndexOf(",");
      const name = (i < 0 ? line : line.slice(0, i)).trim();
      const mib = parseFloat(i < 0 ? "" : line.slice(i + 1)); // "8192 MiB" → 8192; "[N/A]" → NaN
      return { name, vramGB: Number.isFinite(mib) ? Math.round((mib / 1024) * 10) / 10 : 0 };
    });
}

/** Median MMAC/s (64^3 multiply-adds per run) over 3 timed 64x64 integer matrix multiplies. */
export function benchmarkMmacPerSec(): number {
  const n = 64;
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const a = randomIntMatrix(n);
    const b = randomIntMatrix(n);
    const start = performance.now();
    multiply(a, b, n);
    times.push((performance.now() - start) / 1000);
  }
  times.sort((x, y) => x - y);
  const medianSec = times[1];
  return n ** 3 / 1e6 / medianSec;
}

function randomIntMatrix(n: number): Int32Array {
  const m = new Int32Array(n * n);
  for (let i = 0; i < m.length; i++) m[i] = (Math.random() * 2000 - 1000) | 0;
  return m;
}

function multiply(a: Int32Array, b: Int32Array, n: number): Int32Array {
  const c = new Int32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const av = a[i * n + k];
      for (let j = 0; j < n; j++) {
        c[i * n + j] += av * b[k * n + j];
      }
    }
  }
  return c;
}
