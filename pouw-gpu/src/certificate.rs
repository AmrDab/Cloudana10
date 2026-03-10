//! POUW certificate format shared between Rust miner and orchestrator.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct POUWCertificate {
    pub sigma: String,
    pub n: usize,
    pub r: usize,
    pub matrix_a_hash: String,
    pub matrix_b_hash: String,
    pub transcript_hash: String,
    pub z: String,
    pub difficulty: u32,
    pub timestamp: u64,
    pub provider_address: String,
    pub device_id: String,
    pub matrix_a: Vec<u64>,
    pub matrix_b: Vec<u64>,
}
