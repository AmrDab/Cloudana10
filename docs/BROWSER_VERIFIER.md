# Cloudana Browser Verifier (Lite Node)

**Status:** design + front-end prototype. Depends on the orchestrator being live (Phase 1.5).
**One-liner:** anyone can contribute spare browser compute *as a verifier* in the challenger
network — no install, opt-in, earning non-transferable testnet credits.

---

## Why this exists

Two wins for a DePIN cold-start:
1. **Instant supply-side onboarding.** No daemon, no Linux box — open a tab, opt in, contribute.
2. **Test the waters.** Real telemetry on who shows up and what hardware the long tail has,
   before committing to a heavy provider-node rollout.

We already ship the hard part: the Proof Lab on cloudana.io runs the real cuPOW engine in the
browser (WebCrypto SHA-256, real matmul, real difficulty, σ from Base). Browser Verifier is that
engine, gated behind consent, fed real verification tasks instead of self-generated ones.

## The core decision: verifiers, not a reward faucet

Browser nodes do **certificate verification** in the existing `ChallengeManager` challenger network
— NOT throwaway sandboxed makework. This is deliberate:

- Verification (recompute `z` from σ‖nonce‖transcript‖H(A)‖H(B), confirm difficulty; optionally a
  Freivalds product check) is **O(1), stateless, uptime-free** — a perfect fit for a tab that can
  close anytime.
- It is **genuinely useful** (fraud detection), so rewarding it does not reintroduce the
  random-matrix farming / self-dealing vector flagged in the original audit.
- Sybil resistance and slashing already exist in the challenger design — we reuse them rather than
  inventing a parallel faucet.

Small WebGPU/Wasm PoUW for browser nodes is a later tier (2.5). Verification is the honest v1.

## Rewards: testnet credits, NOT pre-release token

🟥 **Hard rule.** Browser contribution earns **non-transferable testnet "verifier credits" with no
monetary value and no promised conversion.** We do not distribute a pre-release token to the public.
A public token-for-compute giveaway with implied future value is a securities landmine and breaks
the project's honesty positioning. Credits are a transparent contribution ledger. *If and when*
legal review clears a real token event, credits *may* inform a future distribution — stated as a
possibility, never a commitment. (Consistent with the existing Terms: testnet CLD has no value.)

## Consent model

Wallet connection ≠ compute consent.

- **Wallet connect** (`eth_requestAccounts`) = identity + payout address only.
- **Compute consent** = a *separate* `personal_sign` over an explicit message:

  ```
  Cloudana Compute Consent v1
  I authorize this browser to run verification tasks while this tab is open.
  Caps: CPU intensity ≤ {level} · stops when tab closes · no background execution.
  Address: {addr}  Nonce: {nonce}  Issued: {iso8601}
  ```

  Stored locally, revocable, surfaced in the live task log. This single signature is the line
  between "opt-in verifier" and "cryptojacking." No injected wallet → an explicit typed-consent
  fallback that is clearly labelled unsigned/demo.

## Controls (all enforced client-side, all visible)

- **Intensity** (Low/Med/High) → duty-cycle throttle: work burst then sleep, capping average CPU.
- **Only while tab is open** — work runs in the page; closing the tab stops it. No service-worker
  background compute for contribution.
- **Battery guard** — `navigator.getBattery()`; if discharging + low, warn and suggest pausing.
- **Hard Stop** — instant halt.
- **Live task log** — every task: id, type, result, credit delta. Radical transparency.

## Three tiers (positioning)

| Tier | Who | Work | Reward | Uptime |
|---|---|---|---|---|
| 1 · User | wallet connected | none (instant app feel) | — | — |
| 2 · **Browser Verifier** | opt-in + signed consent | certificate verification | testnet credits | none needed |
| 3 · Provider Node | installed daemon | containers, GPU PoUW, storage | CLD (testnet→mainnet) | required |

## What browser nodes must NOT do (yet)

Hosting, long-lived containers, public APIs, databases, private customer workloads, anything with
uptime guarantees, OS access, or background-after-leave compute. Browsers are sandboxed and
unreliable (tabs close, devices sleep, hidden tabs throttle). They are a verification long-tail,
not infrastructure.

## Backend wiring (Phase 1.5, needs orchestrator live)

- `GET  /v1/verify/tasks?addr=` → batch of certificates to check (drawn from the challenger queue).
- `POST /v1/verify/results` → `{ taskId, verdict, proofOfCheck }`, signed by the consented address.
- Orchestrator cross-checks a sample, credits the ledger, and slashes/ignores dishonest verifiers
  per existing challenger rules. Credits ledger is off-chain on testnet (D1), transparent per-addr.

## Instant-feel layer (orthogonal, ship anytime)

Independent of contribution: a service worker for offline-first app shell + asset caching, local
task pre-packaging (compress/hash/encrypt before send), and optimistic "deploying…" UI. Makes the
app feel instant to the *same* user without pretending their browser is a datacenter.

## Build order

1. **Front-end prototype** (`client/public/browser-contribute.html`, served at `/browser-contribute`)
   — consent flow + real local cuPOW verification loop + credits ledger + controls. No backend.
   *(This doc ships with it.)*
2. Orchestrator task-feed endpoints (after Akash deploy).
3. Wire prototype → real challenge queue; move credits ledger to D1.
4. Integrate the opt-in toggle into the Proof Lab section on the landing page.
