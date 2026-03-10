//! Block-based MatMul_r with transcript hash recording.
//!
//! Implements Algorithm 6.1 from Komargodski & Weinstein (IACR 2025/685).
//! Records all nb³ intermediate r×r partial sum matrices into a rolling SHA-256 hash.

use sha2::{Digest, Sha256};
use crate::matrix::Matrix;

pub struct MatMulResult {
    pub C: Matrix,
    pub transcript_hash: [u8; 32],
    pub intermediate_count: usize,
}

/// Block-based matrix multiplication recording ALL intermediate partial sums.
///
/// For n×n matrices with block size r:
///   nb = n/r blocks per dimension
///   Records nb³ intermediate r×r matrices into a rolling SHA-256.
///   Total complexity: O(n³) for computation + O(n³/r) hash calls.
pub fn matmul_with_transcript(a: &Matrix, b: &Matrix, r: usize) -> MatMulResult {
    let n = a.rows;
    assert_eq!(n % r, 0, "n ({n}) must be divisible by r ({r})");
    let nb = n / r;

    let mut c = Matrix::new(n, n);
    let mut hasher = Sha256::new();
    let mut count = 0usize;

    for bi in 0..nb {
        for bj in 0..nb {
            let mut cij = Matrix::new(r, r); // starts as zero

            for bl in 0..nb {
                // C_{bi,bj}^{(bl)} = C_{bi,bj}^{(bl-1)} + A_{bi,bl} × B_{bl,bj}
                let ail = a.get_block(bi * r, bl * r, r);
                let blj = b.get_block(bl * r, bj * r, r);
                let prod = ail.mul(&blj);

                // Add prod into cij
                for (ci, (&p, s)) in prod.data.iter().zip(cij.data.iter_mut()).enumerate() {
                    *s = crate::addmod(*s, p);
                }

                // Hash this intermediate state into the transcript
                for &val in &cij.data {
                    hasher.update(val.to_be_bytes());
                }
                count += 1;
            }

            c.set_block(bi * r, bj * r, &cij);
        }
    }

    MatMulResult {
        C: c,
        transcript_hash: hasher.finalize().into(),
        intermediate_count: count,
    }
}
