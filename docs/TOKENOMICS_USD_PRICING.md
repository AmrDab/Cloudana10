# CLD pricing: keep CLD-native, or quote in USD and settle in CLD?

Independent token-economics opinion, 2026-10-12. Verified against `ledger.service.ts`, `pricing.service.ts`, `env.ts`,
`deployment-spec.ts`, `CloudanaSettlementV2.sol`, `CLDTokenV2.sol`, DECISIONS_CONSENSUS, REVIEW_PANEL_2026-10,
CLD_ISSUANCE_DESIGN, IMPL_SPEC_2026-10, V4_VERIFIED_SERVICES, whitepaper §5–6 and TOKENOMICS_SIM_20Y. New numbers:
`npx tsx scripts/sim/usd-pricing.ts` (options `--twap`, `--step`, `--breaker`). Nothing else was changed.

## Verdict

**Quote every price in USD and settle in CLD at mainnet. Keep the ledger, the 95/3/2 split, the subsidy budget and
the settlement contract exactly as they are — CLD-native, no oracle in settlement.** The rate enters in one place:
the number of CLD a quote asks for. Confidence ≈80 % for mainnet; the residual risk is a thin launch pool, handled by
a constant rate until the pool is deep.

**On testnet, do the same with a constant rate.** `CLD_USD_RATE` already exists; make the µCLD price tables USD tables
multiplied by it. Nothing changes economically (there is no market price), but the quote path, the rate lock and the
console copy get built and tested before an oracle is read.

**Not a permanent hybrid.** The simulation shows "matmul in CLD, hourly services in USD" captures most of the benefit,
because the hourly services are where the damage is — but one rule is clearer to users and lets the matmul controller
measure demand instead of currency.

The October panel rejected a USD oracle "as an added trust point". In the quote it is not one: the orchestrator
already sets every price unilaterally (a controller output and seven env vars), and "a bounded one-hour average of a
public pool" is less trust than "a rate the owner typed". I keep the panel's two real decisions: no protocol-run
USDC buy-and-burn (custody), and no oracle in settlement.

Owner's intuitions: *"when CLD goes up it costs less CLD for a node to operate"* is exactly what USD quoting makes
true — the CLD fee per GPU-hour shrinks as CLD rises; the dollar fee does not. *"CLD gets the $3, which gives a
benchmark valuation per token"* is not true under any model and must not be said (§1, §5).

## 1. What the fee loop does for the price

Per $1 of fees, with every minted CLD sold:

| Flow | Budget not binding (launch years) | Budget binding |
|---|---|---|
| User buys CLD | +$1.00 | +$1.00 |
| Provider minted (lane A) | −$0.95 | −$0.95 |
| Treasury minted | −$0.03 | −$0.03 |
| Subsidy (ρ 0.04 × ~85 % proven) | −$0.034 | fixed CLD/yr (≤ 4 % of genesis, later 1 % of supply) |
| **Net demand for CLD** | **−$0.014** | **+$0.02 − subsidy** |

Only 2 % of a fee is destroyed, and lane B can add 4 % back: while the budget is not binding (base case: through
year 6) the protocol is a net *seller* of ≈1.4 % of fees. At the 20-year base-case fee levels:

| Fees $/yr | Net burn | Subsidy | Net holder flow | 3-day float | Price floor at V = 10 |
|---|---|---|---|---|---|
| $545k (y1) | $11k | $19k | −$8k | $4k | $0.0005 |
| $2.9M (y5) | $58k | $99k | −$41k | $24k | $0.003 |
| $15.5M (y10) | $310k | $400k cap | −$90k | $127k | $0.016 |
| $100M | $2.0M | $400k cap | +$1.6M | $822k | $0.10 |

Nothing in the mechanism "values" CLD. What supports the price: the net burn once fees are large (a 2 %-of-fees
buyback), the float users hold for the hours between buying and burning (days of fees), holders who do not sell, and
the pool. The $3 goes to whoever sold the user their CLD — mostly providers — whether the swap happens in the user's
wallet or in a protocol contract; who swaps changes custody risk, not valuation. This arithmetic is identical under
both quoting models. Quoting only decides who carries the currency risk between quote and settlement.

## 2. The three models under price shocks

24 months, hourly steps, shock at month 6; 100M supply, $0.10 start; proven matmul (home GPUs, controller, lane B)
and hourly GPU services (datacenter GPUs, fixed table, fees only), $25k and $50k/month of demand at reference,
elasticity 0.7; 95/3/2, ρ 0.04, mainnet budget, 48 h lane-A lag. "User price" is the true dollar price against the
same model's flat path, hour by hour — the currency effect only.

**Hourly services (hosting, containers, workstations, endpoints — seven fixed µCLD env vars, no controller):**

| Path | Model | User price vs flat | Hours > 20 % off | Provider margin min / mean | Fleet 50 → | Work served |
|---|---|---|---|---|---|---|
| Crash ÷10 over 30 d | cld | 0.10× | 13,070 of 13,140 | −450 % / −424 % | 5 | 82 % |
| | usd | 1.00× | 0 | −14 % / +1 % | 50 | 100 % |
| Fast crash ÷3 in 48 h | cld | 0.33× | 13,130 | −67 % / −64 % | 5 | 83 % |
| | usd | 1.00× | 0 | −4 % / +1 % | 50 | 100 % |
| Rise ×10 over 90 d | cld | 10.0× | 12,968 | +13 % / +17 % | 91 | 25 % |
| | usd | 1.00× | 0 | +2 % / +3 % | 50 | 100 % |
| Volatile (σ 8 %/day; $0.04–$0.19) | cld | 0.39×–1.89× | 7,711 | −11 % / +7 % (4 months < 0) | 50 | 101 % |
| | usd | 1.00× | 0 | −1 % / +3 % | 50 | 100 % |
| Flash ×3 for 6 h | cld | 3.00× for 6 h | 6 | — | 50 | 100 % |
| | usd (1 h TWAP, pause > 20 %) | 1.5× for 1 h, 2 h paused | 1 | — | 50 | 100 % |

**Proven matmul (±2 %/h utilization controller).** The controller is an implicit, lagging dollar anchor. It tracks
anything slower than ≈2 %/h (≈40 %/day): rise ×10 over 90 days, trough 0.88×, no hour more than 20 % off; crash ÷10
over 30 days, peak 1.15×; ÷3 in 48 h, trough 0.84×. It cannot track a flash (3.00× for six hours) and its EMA bounds
cap any move at 10× per month. The ≈11 % residual on the rise and volatile paths is the same under both models: fleet
divergence, not currency.

**Supply.** Under a ÷10 crash, USD quoting burns 124M CLD over the window against 44M CLD-native (whose hourly fees
stay fixed in CLD); monthly fee velocity peaks at 7 % of supply; net supply −1.1M vs +0.5M (CLD-native: the matmul
subsidy scaled ×10 while the fixed hourly fees did not — lane B ÷ burn 3.1 % vs 1.1 %). The budget never binds at
these volumes (10,959 CLD/day ≈ 45× the subsidy earned). This is the burn-and-mint stabiliser: a falling price makes
users buy ten times the CLD per dollar of work.

**Failure modes.** CLD-native has the reflexive one: price falls → fixed-CLD services pay providers a tenth in dollars
→ exit (50 → 5 nodes) before anyone edits an env var; the controller damps it for matmul unless the move outruns its
step. USD-quoted has no reflexive loop on the fee side (provider dollars per unit are constant). Its failure modes:
oracle outage or a drained pool — quotes pause, nothing settles wrongly; thin liquidity — slippage is a hidden
surcharge, which the panel's ≥30× daily-fee pool and 1 % cap bound; and the 48 h settlement lag, identical under both
models — providers hold CLD for two days, so a 30-day ÷10 crash costs them 14 % of a month's margin either way.

## 3. Mechanism design

**Pegged to USD:** everything the user is charged — the seven hourly prices (USD/h), the matmul price (nano-USD per
TMAC; the controller steps it exactly as `stepPrice` does today, EMA bounds included), the base fee, later provider
floors in $/kWh. A quote carries `{usdPrice, rateUsdPerCld, cldAmount, expiresAt}`; the CLD amount is escrowed and
split by the ledger. Hourly bills convert at each hour's rate; the console shows "$2.50/h ≈ 25 CLD/h at today's rate".

**Rate before listing:** a governance constant. Today `CLD_USD_RATE=100` means $0.01/CLD while the 14,000 nCLD/TMAC
launch price assumes $0.10: an H100-hour is 20.16 CLD — $0.20 at the constant, $2 in the DECISIONS table — and the
datacenter GPU-hour env price (6,000 µCLD) is 3,360× below the matmul price of the same GPU-hour. One USD reference
fixes both. At mainnet keep the constant at the listing price, stepped ≤ ±10 %/day by the Safe, until the CLD/USDC
pool has held ≥30× daily fees for 14 days.

**Rate after listing:** one-hour TWAP of the protocol's CLD/USDC pool on Base (Uniswap v3 `observe` or Aerodrome),
read every five minutes over a read-only RPC, no key. Pause quoting when spot is >20 % from the 1 h TWAP; a ±50 %/h
sanity rail against bad feed data (a tight ±10 %/h rail costs users 2.7× for seven hours in a real flash; without it,
one hour at 1.5×); pause after 15 minutes of staleness; manual review when the 1 h and 24 h TWAPs differ by >50 %.
A 24 h TWAP is wrong for quoting: it lags a 48 h crash by half a day (users at 0.48×) and pauses 28–39 hours.

**Quote lock:** the 5-minute lock locks the rate with the price in the same `price_state` row. The user's free
five-minute option on the rate is worth ≤0.5 % of the fee at 150 % annualised volatility.

**Settlement and invariants: unchanged.** `postEpoch` sees `feesBurned` in CLD and checks treasury ≥ 3 %, lane A +
treasury ≤ 98 %, lane B ≤ allowance, fees ≤ escrow — no rate anywhere. The self-dealing bound holds exactly: whoever
pays F CLD gets back ≤ 0.99 F CLD, and the same F enters both sides. One sharpening: the per-job µCLD round-up and
the 1,000 µCLD base fee (sim finding 8) become large fractions of a small F once CLD is worth dollars — quote the
base fee in USD and re-denominate the ledger to nCLD before mainnet.

**Oracle manipulation.** Push the rate *up* → users pay fewer CLD, providers are minted fewer: a user-side attacker
gains δ × fees quoted in the window. Push it *down* → providers are minted more, but receive it two days later, after
the push: gain ≈0. The protocol never loses (mint ≤ 98 % of burn). Pool at 30× daily fees, δ = 10 %:

| Window | Gain ÷ pool depth | At $1M/yr fees | At $100M/yr |
|---|---|---|---|
| 5 min | 0.0012 % | $1 | $95 |
| 1 h TWAP | 0.014 % | $11 | $1,142 |
| 24 h TWAP | 0.33 % | $274 | $27k |

Holding a 10 % deviation for an hour against arbitrage costs a multiple of the pool; the gain is 0.014 % of it.

## 4. The subsidy budget stays in CLD, as a fraction of supply

Its job is to bound dilution, a supply quantity; ρ ≤ 0.04 already bounds it per fee in whatever F is. A USD budget
would need the oracle inside the contract and, after a crash, could mint an unbounded share of supply. Only change:
replace the fixed `EPOCH_SUBSIDY_BUDGET_UCLD` integer with the on-chain fraction-of-supply rule, so the two never
disagree.

## 5. Messaging and legal

**Say:** "Prices are in US dollars. You pay in CLD at the rate on your quote; the rate is a one-hour average of the
public CLD/USDC pool on Base." "The fee is burned; CLD is minted for the verified job." "Testnet prices are shown in
dollars for reference; test CLD has no value."

**Never say:** that CLD "captures" or "receives" the fee; "benchmark valuation", "price floor", "buy pressure",
"deflationary", "scarcity", "cheaper for nodes as CLD rises" (true, but reads as a price thesis); "stable" or
"pegged" (prices are pegged, CLD is not); any projected rate; "earn" for holders. The panel's warning stands:
value-accrual language is the Howey/MiCA profit-expectation pattern.

**For counsel:** (1) whether a USD quote plus an in-wallet swap and a Coinbase Onramp referral is payment
facilitation — Cloudana never holds the other asset, but `/payments/convert` and any "pay with USDC" button need a
look; (2) MiCA: USD quoting strengthens a "means of payment" reading — utility vs e-money/ART analysis before any EU
presence; (3) publishing a TWAP from a treasury-seeded pool — market-making and manipulation duties; (4) consumer
price-display rules when charging in a volatile asset: CLD amount, rate and expiry before confirmation; (5) the 2 %
destruction and 3 % treasury mint in the classification memo; (6) providers' income at mint.

## 6. What this decision drives

Testnet now: USD price tables and base fee × one constant (USD per CLD, 0.10); the controller on nano-USD/TMAC; the
quote carrying the rate; `priceUcldPerHour` derived from USD at quote time; console and homepage copy per §5. Before
listing: the rate module (TWAP reader, bounds, pauses) behind a flag; the launch constant regime; the nCLD ledger.
The contract, the keeper and the fee split do not change.
