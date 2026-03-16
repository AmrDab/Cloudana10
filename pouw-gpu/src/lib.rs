//! cloudana-pouw-gpu — GPU-accelerated cuPOW matrix multiplication.
//!
//! Implements Algorithm 6.4 from Komargodski & Weinstein (IACR 2025/685).
//!
//! # Backend selection
//! - Feature `cuda`: Uses cudarc to run matmul on NVIDIA GPU.
//! - Feature `cpu` (default): Pure Rust CPU fallback using SIMD-optimized loops.
//!
//! # Performance targets (mainnet)
//! | Backend | n=256, r=8 | n=512, r=16 |
//! |---------|-----------|------------|
//! | CPU (Rust opt) | ~800ms | ~6s |
//! | CUDA (RTX 4090) | ~2ms | ~15ms |
//!
//! For testnet, use the TypeScript implementation (no GPU required).

pub mod matrix;
pub mod cupow;
pub mod transcript;
pub mod certificate;

pub use cupow::{solve, verify};
pub use certificate::POUWCertificate;

/// Field prime p = 1_000_000_007.
pub const PRIME: u64 = 1_000_000_007;

/// Perform (a * b) mod PRIME safely (no overflow for u64).
#[inline(always)]
pub fn mulmod(a: u64, b: u64) -> u64 {
    ((a as u128 * b as u128) % PRIME as u128) as u64
}

/// Perform (a + b) mod PRIME.
#[inline(always)]
pub fn addmod(a: u64, b: u64) -> u64 {
    let s = a + b;
    if s >= PRIME { s - PRIME } else { s }
}

/// Perform (a - b) mod PRIME (unsigned safe).
#[inline(always)]
pub fn submod(a: u64, b: u64) -> u64 {
    if a >= b { a - b } else { a + PRIME - b }
}
