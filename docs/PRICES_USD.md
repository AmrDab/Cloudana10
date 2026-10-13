# Dollar price table

Status: **approved by the owner 2026-10-13; live in the API** (env.ts defaults, `GET /v1/network` → `prices`) · proposed 2026-10-12. Follows the approved decision to quote in US dollars and
settle in CLD ([TOKENOMICS_USD_PRICING.md](TOKENOMICS_USD_PRICING.md)); testnet reference rate **$0.10 per CLD**.
Every price is what the user pays per hour; the provider is minted 95 % of it, the treasury 3 %, 2 % is destroyed.

## Two rules
1. **A GPU-hour costs about the same whether it is rented or used for proven compute jobs.** The compute price
   (14,000 nCLD per tera-MAC = 1,400 nano-dollars per tera-MAC) makes an H100-hour of matrix work about $2.02. Rental
   prices sit near that line, so a provider has no reason to prefer one kind of work over the other.
2. **At or under the community GPU clouds, far under the hyperscalers.** Market figures checked 2026-10-12 (sources
   below).

## The table

| Resource | Today, at $0.10/CLD | Proposed | Market reference |
|---|---|---|---|
| Compute job | 1,400 n$/TMAC + $0.0001/job | **unchanged** | — |
| Static site | $0.000005/h | **$0.0014/h** (≈ $1/month) | one free site per verified identity stays |
| vCPU | $0.00002/h | **$0.010/h** | Fargate $0.0405, Fargate Spot $0.0124 |
| RAM | $0.00001/GB-h | **$0.0012/GB-h** | Fargate $0.0044 |
| Container disk | $0.000002/GB-h | **$0.0001/GB-h** (≈ $0.07/GB-month) | Fargate $0.000111 |
| Workstation volume | $0.0000002/GB-h | **$0.0001/GB-h** | EBS gp3 ≈ $0.00011 |
| GPU, standard (under 40 GB) | $0.0002/h | **$0.30/h** | RTX 4090 $0.34–0.50 on demand; 3090 $0.12–0.22 |
| GPU, large (40–80 GB, A100, L40S, A6000) | $0.0006/h | **$1.20/h** | A100 80 GB $1.39–1.59 |
| GPU, H100-class (H100, H200, B200, GH200) | $0.0006/h | **$2.00/h** | H100 $1.15–3.49, Akash $2.72, AWS P5 $6.88 |
| Interruptible discount | 50 % | **50 %** | spot is roughly half |
| Minimum per deployment | $0.000005/h | **$0.0014/h** | — |

Today's GPU prices are 1,500–3,300× below the compute price of the same GPU-hour; the hourly table was placeholders.

## What things cost

| Example | Per hour | Per month | Comparable |
|---|---|---|---|
| Static site | $0.0014 | $1.02 | free tier covers one |
| Small web container: 0.5 vCPU, 1 GB, 1 GB disk | $0.0063 | $4.60 | Fargate $18.0 |
| GPU endpoint replica: standard GPU, 4 vCPU, 16 GB, 50 GB | $0.36 | $266 | RunPod 4090 $0.34–0.74/h |
| GPU endpoint replica: H100, 8 vCPU, 64 GB, 200 GB | $2.18 | $1,590 | RunPod $2.89–3.49/h, Akash $2.72 |
| H100 workstation, interruptible, same spec | $1.09 | — | spot ≈ half of on demand |

At $0.10 per CLD, $0.36/h is 3.6 CLD/h. Testnet credits are 10 CLD a day, enough for about 2.7 hours of a standard GPU
endpoint a day.

## One structural change this needs
GPUs are priced by two classes today, and "datacenter" lumps a T4 with an H100. The table uses **three tiers by the
GPU the user asks for**: standard (under 40 GB), large (40–80 GB, pre-Hopper) and H100-class. The node's GPUs are
classified the same way from nvidia-smi names and memory. "Any" class goes away: the user picks a tier, and a tier is
placed only on GPUs of that tier, so an H100 owner is never paid the standard price.

## Sources
- RunPod: [Northflank](https://northflank.com/blog/runpod-gpu-pricing), [Thunder Compute](https://www.thundercompute.com/blog/runpod-pricing-vs-thunder-compute), [gpucost.org](https://gpucost.org/provider/runpod)
- Vast.ai: [getdeploying.com](https://getdeploying.com/gpus/nvidia-rtx-4090), [SynpixCloud](https://www.synpixcloud.com/blog/vast-ai-vs-runpod-rtx-4090-pricing)
- AWS Fargate: [AWS](https://aws.amazon.com/fargate/pricing/), [Cloudchipr](https://cloudchipr.com/blog/aws-fargate-pricing)
- Akash and H100 market: [Akash](https://akash.network/the-bid/h100-rental-price-2026-cost-per-hour/), [computeprices.com](https://computeprices.com/providers/akash/gpus/h100)
