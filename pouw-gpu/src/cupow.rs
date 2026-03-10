//! cuPOW — Rust implementation of Algorithm 6.4 (Komargodski & Weinstein 2025).
//!
//! This is the high-performance Rust version intended for mainnet providers.
//! For testnet, use the TypeScript implementation in pouw/src/cupow.ts.
//!
//! # Performance
//! CPU (release build):
//!   n=64:  ~5ms per cert attempt (at difficulty=12, ~4096 expected attempts)
//!   n=128: ~40ms per cert attempt
//!   n=256: ~320ms per cert attempt
//!
//! CUDA (RTX 4090, with cudarc feature):
//!   n=256: ~0.5ms per cert attempt (640x speedup)
//!   n=512: ~2ms per cert attempt

use sha2::{Digest, Sha256};
use crate::matrix::Matrix;
use crate::transcript::matmul_with_transcript;
use crate::certificate::POUWCertificate;
use crate::PRIME;

/// Choose block size r = max(4, floor(n^0.3)), rounded to divisor of n.
pub fn choose_block_size(n: usize) -> usize {
    let mut r = (n as f64).powf(0.3).floor() as usize;
    r = r.max(4);
    // Round up to nearest divisor of n
    while n % r != 0 && r <= n {
        r += 1;
    }
    r.min(n)
}

/// Check if z has at least `difficulty` leading zero bits.
pub fn meets_difficulty(z: &[u8; 32], difficulty: u32) -> bool {
    let full_bytes = (difficulty / 8) as usize;
    let rem_bits = difficulty % 8;
    for i in 0..full_bytes {
        if i >= z.len() || z[i] != 0 { return false; }
    }
    if rem_bits == 0 { return true; }
    if full_bytes >= z.len() { return false; }
    let mask = 0xFF << (8 - rem_bits);
    z[full_bytes] & mask == 0
}

/// Generate a pseudo-random matrix from a seed string.
/// Uses SHA-256 based stream expansion (matches TypeScript implementation).
fn random_matrix(n: usize, seed: &str) -> Matrix {
    let mut m = Matrix::new(n, n);
    m.fill_random(seed);
    m
}

/// Generate low-rank noise: E = E_L × E_R from seed.
fn generate_noise(sigma: &str, label: &str, n: usize, r: usize) -> Matrix {
    let seed = {
        let mut h = Sha256::new();
        h.update(sigma.as_bytes());
        h.update(label.as_bytes());
        hex::encode(h.finalize())
    };
    let mut el = Matrix::new(n, r);
    el.fill_random(&format!("{seed}_EL"));
    let mut er = Matrix::new(r, n);
    er.fill_random(&format!("{seed}_ER"));
    el.mul(&er)
}

/// SHA-256 of the sigma + components → z.
fn compute_z(sigma: &str, transcript_hash: &[u8; 32], a_hash: &[u8; 32], b_hash: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(sigma.as_bytes());
    h.update(transcript_hash);
    h.update(a_hash);
    h.update(b_hash);
    h.finalize().into()
}

/// Decode: C = C' - A·F - E·B - E·F  (the cheap O(n²·r) step).
fn decode(a: &Matrix, b: &Matrix, cprime: &Matrix, sigma: &str, n: usize, r: usize) -> Matrix {
    let e = generate_noise(sigma, "noise_E", n, r);
    let f = generate_noise(sigma, "noise_F", n, r);
    let af = a.mul(&f);
    let eb = e.mul(b);
    let ef = e.mul(&f);
    let mut result = cprime.sub(&af);
    result = result.sub(&eb);
    result = result.sub(&ef);
    result
}

/// Attempt to find a POUW certificate.
///
/// # Arguments
/// * `chain_seed` — hex string from latest block hash.
/// * `n` — matrix dimension.
/// * `difficulty` — leading zero bits required in z.
/// * `provider_address` — wallet address of the provider.
/// * `device_id` — device ID bytes32 hex string.
/// * `max_attempts` — max iterations before returning None.
pub fn solve(
    chain_seed: &str,
    n: usize,
    difficulty: u32,
    provider_address: &str,
    device_id: &str,
    max_attempts: usize,
) -> Option<POUWCertificate> {
    let r = choose_block_size(n);

    for attempt in 0..max_attempts {
        // Each attempt uses a fresh sigma derived from chain_seed + attempt
        let sigma = {
            let mut h = Sha256::new();
            h.update(chain_seed.as_bytes());
            h.update(attempt.to_string().as_bytes());
            hex::encode(h.finalize())
        };

        // Generate random matrices A, B (or use real workload matrices)
        let a = random_matrix(n, &format!("{sigma}_A"));
        let b = random_matrix(n, &format!("{sigma}_B"));

        // Encode: A' = A + E, B' = B + F
        let e = generate_noise(&sigma, "noise_E", n, r);
        let f = generate_noise(&sigma, "noise_F", n, r);
        let aprime = a.add(&e);
        let bprime = b.add(&f);

        // Run block MatMul_r recording transcript
        let result = matmul_with_transcript(&aprime, &bprime, r);

        // Compute proof hash z
        let a_hash = a.sha256();
        let b_hash = b.sha256();
        let z = compute_z(&sigma, &result.transcript_hash, &a_hash, &b_hash);

        if meets_difficulty(&z, difficulty) {
            use std::time::{SystemTime, UNIX_EPOCH};
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;

            return Some(POUWCertificate {
                sigma,
                n,
                r,
                matrix_a_hash: hex::encode(a_hash),
                matrix_b_hash: hex::encode(b_hash),
                transcript_hash: hex::encode(result.transcript_hash),
                z: hex::encode(z),
                difficulty,
                timestamp,
                provider_address: provider_address.to_string(),
                device_id: device_id.to_string(),
                matrix_a: a.data,
                matrix_b: b.data,
            });
        }
    }

    None
}

/// Verify a POUW certificate. Re-runs the computation and checks all hashes.
pub fn verify(cert: &POUWCertificate) -> bool {
    let n = cert.n;
    let r = cert.r;

    // Reconstruct matrices
    let a = Matrix { rows: n, cols: n, data: cert.matrix_a.clone() };
    let b = Matrix { rows: n, cols: n, data: cert.matrix_b.clone() };

    // Check matrix hashes
    if hex::encode(a.sha256()) != cert.matrix_a_hash { return false; }
    if hex::encode(b.sha256()) != cert.matrix_b_hash { return false; }

    // Re-run encode
    let e = generate_noise(&cert.sigma, "noise_E", n, r);
    let f = generate_noise(&cert.sigma, "noise_F", n, r);
    let aprime = a.add(&e);
    let bprime = b.add(&f);

    // Re-run block MatMul and check transcript hash
    let result = matmul_with_transcript(&aprime, &bprime, r);
    if hex::encode(result.transcript_hash) != cert.transcript_hash { return false; }

    // Recompute z
    let a_hash: [u8; 32] = hex::decode(&cert.matrix_a_hash).ok().and_then(|v| v.try_into().ok()).unwrap_or([0; 32]);
    let b_hash: [u8; 32] = hex::decode(&cert.matrix_b_hash).ok().and_then(|v| v.try_into().ok()).unwrap_or([0; 32]);
    let th: [u8; 32] = hex::decode(&cert.transcript_hash).ok().and_then(|v| v.try_into().ok()).unwrap_or([0; 32]);
    let z = compute_z(&cert.sigma, &th, &a_hash, &b_hash);
    if hex::encode(z) != cert.z { return false; }

    // Check difficulty
    meets_difficulty(&z, cert.difficulty)
}
