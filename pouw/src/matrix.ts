/**
 * Modular matrix arithmetic over F_p.
 * Uses BigInt internally to avoid JS float overflow for multiplications.
 * p = 1_000_000_007 (a well-known 30-bit prime).
 */

export const PRIME = 1_000_000_007n;
export const PRIME_N = 1_000_000_007; // as number for quick use

export type Matrix = {
  rows: number;
  cols: number;
  data: number[]; // flat row-major, values in [0, PRIME)
};

export function matCreate(rows: number, cols: number): Matrix {
  return { rows, cols, data: new Array(rows * cols).fill(0) };
}

export function matGet(m: Matrix, r: number, c: number): number {
  return m.data[r * m.cols + c];
}

function modp(x: number): number {
  return ((x % PRIME_N) + PRIME_N) % PRIME_N;
}

/** Modular multiply two field elements safely (via BigInt). */
function mulmod(a: number, b: number): number {
  return Number(BigInt(a) * BigInt(b) % PRIME);
}

export function matAdd(a: Matrix, b: Matrix): Matrix {
  const result = matCreate(a.rows, a.cols);
  for (let i = 0; i < a.data.length; i++) {
    result.data[i] = modp(a.data[i] + b.data[i]);
  }
  return result;
}

export function matSub(a: Matrix, b: Matrix): Matrix {
  const result = matCreate(a.rows, a.cols);
  for (let i = 0; i < a.data.length; i++) {
    result.data[i] = modp(a.data[i] - b.data[i]);
  }
  return result;
}

/** Standard O(n³) matrix multiply C = A × B over F_p. */
export function matMul(a: Matrix, b: Matrix): Matrix {
  const result = matCreate(a.rows, b.cols);
  for (let i = 0; i < a.rows; i++) {
    for (let k = 0; k < a.cols; k++) {
      const aik = a.data[i * a.cols + k];
      if (aik === 0) continue;
      const aikBig = BigInt(aik);
      for (let j = 0; j < b.cols; j++) {
        const bkj = b.data[k * b.cols + j];
        if (bkj === 0) continue;
        const idx = i * result.cols + j;
        result.data[idx] = Number((BigInt(result.data[idx]) + aikBig * BigInt(bkj)) % PRIME);
      }
    }
  }
  return result;
}

/** Get r×r block starting at (rowStart, colStart). */
export function matGetBlock(m: Matrix, rowStart: number, colStart: number, r: number): Matrix {
  const block = matCreate(r, r);
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < r; j++) {
      block.data[i * r + j] = m.data[(rowStart + i) * m.cols + (colStart + j)];
    }
  }
  return block;
}

/** Set r×r block starting at (rowStart, colStart). */
export function matSetBlock(m: Matrix, rowStart: number, colStart: number, block: Matrix): void {
  for (let i = 0; i < block.rows; i++) {
    for (let j = 0; j < block.cols; j++) {
      m.data[(rowStart + i) * m.cols + (colStart + j)] = block.data[i * block.cols + j];
    }
  }
}

/** Generate a random n×m matrix using the provided RNG. */
export function matRandom(rows: number, cols: number, rng: () => number): Matrix {
  const m = matCreate(rows, cols);
  for (let i = 0; i < m.data.length; i++) {
    m.data[i] = Math.floor(rng() * PRIME_N) % PRIME_N;
  }
  return m;
}

/** Serialize matrix to a Buffer for hashing (big-endian uint32 per element). */
export function matToBytes(m: Matrix): Buffer {
  const buf = Buffer.alloc(m.data.length * 4);
  for (let i = 0; i < m.data.length; i++) {
    buf.writeUInt32BE(m.data[i], i * 4);
  }
  return buf;
}
