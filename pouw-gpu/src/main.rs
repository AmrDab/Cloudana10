//! Cloudana POUW GPU Miner — high-performance Rust mining daemon.
//!
//! Runs continuous cuPOW mining and submits certificates to the orchestrator.
//! Uses CPU by default; enable `--features cuda` for GPU acceleration.
//!
//! Usage:
//!   cargo run --release -- \
//!     --orchestrator http://localhost:7002 \
//!     --provider-address 0xYOUR_WALLET \
//!     --device-id 0xYOUR_DEVICE_ID \
//!     --difficulty 12 \
//!     --matrix-size 128

use clap::Parser;
use tokio::time::{sleep, Duration};
use tracing::{info, warn, error};
use sha2::{Digest, Sha256};

use cloudana_pouw_gpu::{solve, verify};
use cloudana_pouw_gpu::certificate::POUWCertificate;

#[derive(Parser, Debug)]
#[command(name = "pouw-miner", about = "Cloudana POUW GPU Miner")]
struct Args {
    /// Orchestrator URL for seed fetching and certificate submission
    #[arg(long, default_value = "http://localhost:7002")]
    orchestrator: String,

    /// Provider wallet address (receives mining rewards)
    #[arg(long)]
    provider_address: String,

    /// Provider device ID (bytes32 hex)
    #[arg(long)]
    device_id: String,

    /// Mining difficulty (leading zero bits in z)
    #[arg(long, default_value_t = 12)]
    difficulty: u32,

    /// Matrix dimension n (n×n matrices)
    #[arg(long, default_value_t = 128)]
    matrix_size: usize,

    /// Max attempts per mining round before refreshing seed
    #[arg(long, default_value_t = 1000)]
    batch_size: usize,

    /// Seed refresh interval in seconds
    #[arg(long, default_value_t = 10)]
    seed_refresh_secs: u64,
}

#[derive(serde::Deserialize)]
struct SeedResponse {
    seed: String,
    #[serde(rename = "blockNumber")]
    block_number: String,
}

async fn fetch_seed(orchestrator: &str, client: &reqwest::Client) -> String {
    match client.get(format!("{orchestrator}/v1/pouw/seed")).send().await {
        Ok(res) => match res.json::<SeedResponse>().await {
            Ok(data) => {
                info!("Fetched seed: block #{}", data.block_number);
                data.seed
            }
            Err(e) => {
                warn!("Failed to parse seed response: {e}");
                fallback_seed()
            }
        }
        Err(e) => {
            warn!("Failed to fetch seed: {e}");
            fallback_seed()
        }
    }
}

fn fallback_seed() -> String {
    let window = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() / 10;
    let mut h = Sha256::new();
    h.update(format!("fallback-{window}").as_bytes());
    hex::encode(h.finalize())
}

async fn submit_certificate(orchestrator: &str, cert: &POUWCertificate, client: &reqwest::Client) -> bool {
    match client
        .post(format!("{orchestrator}/v1/pouw/submit"))
        .json(cert)
        .send()
        .await
    {
        Ok(res) if res.status().is_success() => {
            let body: serde_json::Value = res.json().await.unwrap_or_default();
            info!("Certificate accepted: {}", body.get("certificateId").and_then(|v| v.as_str()).unwrap_or("?"));
            true
        }
        Ok(res) => {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            warn!("Certificate rejected: HTTP {status} — {body}");
            false
        }
        Err(e) => {
            error!("Submission error: {e}");
            false
        }
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();

    let args = Args::parse();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("Failed to build HTTP client");

    info!("=== Cloudana POUW Miner ===");
    info!("  Provider: {}", args.provider_address);
    info!("  Device:   {}", args.device_id);
    info!("  Matrix:   {}×{}", args.matrix_size, args.matrix_size);
    info!("  Difficulty: {} bits (~{} expected attempts)", args.difficulty, 1u64 << args.difficulty);
    info!("  Orchestrator: {}", args.orchestrator);

    let mut seed = fetch_seed(&args.orchestrator, &client).await;
    let mut last_seed_refresh = std::time::Instant::now();
    let mut total_attempts = 0u64;
    let mut total_found = 0u64;
    let start = std::time::Instant::now();

    loop {
        // Refresh seed periodically
        if last_seed_refresh.elapsed().as_secs() >= args.seed_refresh_secs {
            seed = fetch_seed(&args.orchestrator, &client).await;
            last_seed_refresh = std::time::Instant::now();
        }

        // Mine one batch on a blocking thread (CPU-intensive)
        let seed_clone = seed.clone();
        let provider = args.provider_address.clone();
        let device = args.device_id.clone();
        let n = args.matrix_size;
        let diff = args.difficulty;
        let batch = args.batch_size;

        let cert = tokio::task::spawn_blocking(move || {
            solve(&seed_clone, n, diff, &provider, &device, batch)
        }).await.unwrap_or(None);

        total_attempts += batch as u64;

        if let Some(c) = cert {
            total_found += 1;
            let elapsed = start.elapsed().as_secs_f64();
            let rate = total_attempts as f64 / elapsed;
            info!("🎯 Certificate #{total_found} found! z={}... | {rate:.0} attempts/s", &c.z[..16]);
            submit_certificate(&args.orchestrator, &c, &client).await;
            // Refresh seed after finding cert
            seed = fetch_seed(&args.orchestrator, &client).await;
            last_seed_refresh = std::time::Instant::now();
        }

        // Brief yield between batches
        tokio::task::yield_now().await;
    }
}
