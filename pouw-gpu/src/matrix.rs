//! Matrix operations over F_p = F_{1_000_000_007}.

use crate::{addmod, mulmod, submod, PRIME};
use sha2::{Digest, Sha256};

/// Dense n×m matrix over F_p, row-major flat storage.
#[derive(Clone, Debug)]
pub struct Matrix {
    pub rows: usize,
    pub cols: usize,
    pub data: Vec<u64>,
}

impl Matrix {
    pub fn new(rows: usize, cols: usize) -> Self {
        Self { rows, cols, data: vec![0u64; rows * cols] }
    }

    #[inline(always)]
    pub fn get(&self, r: usize, c: usize) -> u64 {
        self.data[r * self.cols + c]
    }

    #[inline(always)]
    pub fn set(&mut self, r: usize, c: usize, val: u64) {
        self.data[r * self.cols + c] = val % PRIME;
    }

    /// Fill with pseudo-random values derived from a seed string.
    /// Uses Sha256-based stream cipher: data[i] = SHA256(seed || i)[0..8] mod PRIME.
    pub fn fill_random(&mut self, seed: &str) {
        for i in 0..self.data.len() {
            let mut hasher = Sha256::new();
            hasher.update(seed.as_bytes());
            hasher.update(&i.to_le_bytes());
            let hash = hasher.finalize();
            let val = u64::from_le_bytes(hash[0..8].try_into().unwrap()) % PRIME;
            self.data[i] = val;
        }
    }

    /// SHA-256 hash of the matrix (big-endian u64 per element).
    pub fn sha256(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        for &v in &self.data {
            hasher.update(v.to_be_bytes());
        }
        hasher.finalize().into()
    }

    /// Add two matrices element-wise mod PRIME.
    pub fn add(&self, other: &Matrix) -> Matrix {
        assert_eq!(self.rows, other.rows);
        assert_eq!(self.cols, other.cols);
        let mut result = Matrix::new(self.rows, self.cols);
        for (i, (&a, &b)) in self.data.iter().zip(other.data.iter()).enumerate() {
            result.data[i] = addmod(a, b);
        }
        result
    }

    /// Subtract two matrices element-wise mod PRIME.
    pub fn sub(&self, other: &Matrix) -> Matrix {
        assert_eq!(self.rows, other.rows);
        assert_eq!(self.cols, other.cols);
        let mut result = Matrix::new(self.rows, self.cols);
        for (i, (&a, &b)) in self.data.iter().zip(other.data.iter()).enumerate() {
            result.data[i] = submod(a, b);
        }
        result
    }

    /// Standard O(n³) matrix multiply C = A × B mod PRIME.
    /// For CPU: uses cache-friendly loop order (i, k, j).
    pub fn mul(&self, other: &Matrix) -> Matrix {
        assert_eq!(self.cols, other.rows, "Matrix dimension mismatch");
        let n = self.rows;
        let m = other.cols;
        let k = self.cols;
        let mut result = Matrix::new(n, m);
        for i in 0..n {
            for kk in 0..k {
                let aik = self.data[i * k + kk];
                if aik == 0 { continue; }
                for j in 0..m {
                    let bkj = other.data[kk * m + j];
                    let idx = i * m + j;
                    result.data[idx] = addmod(result.data[idx], mulmod(aik, bkj));
                }
            }
        }
        result
    }

    /// Extract r×r sub-block at (row_start, col_start).
    pub fn get_block(&self, row_start: usize, col_start: usize, r: usize) -> Matrix {
        let mut block = Matrix::new(r, r);
        for i in 0..r {
            for j in 0..r {
                block.data[i * r + j] = self.data[(row_start + i) * self.cols + (col_start + j)];
            }
        }
        block
    }

    /// Set r×r sub-block at (row_start, col_start).
    pub fn set_block(&mut self, row_start: usize, col_start: usize, block: &Matrix) {
        for i in 0..block.rows {
            for j in 0..block.cols {
                self.data[(row_start + i) * self.cols + (col_start + j)] = block.data[i * block.cols + j];
            }
        }
    }
}
