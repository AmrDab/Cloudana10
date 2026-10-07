# Owner runbook: testnet go-live

Everything that doesn't need your keys or accounts is built, tested and deployed (PR #5).
These steps need you. Do them in order; each says what to send back to Claude, if anything.
Never paste a private key into chat, a file in the repo, or a web form other than the ones named here.

Commands use **PowerShell** from the repo root unless noted. Wrangler is already logged in on this machine.
Use one of these as `<wrangler>`:
- `npx wrangler`
- `node $env:LOCALAPPDATA\npm-cache\_npx\32026684e21afda6\node_modules\wrangler\bin\wrangler.js`

---

## 1. Lock down the leaked key (15 min, do first)
The key in commit `86fa598` controls the **old** Base Sepolia contracts. Its exposure is permanent; we abandon those contracts rather than fix them.

1. Delete the old chain key from the API Worker. The API no longer uses it.
   ```powershell
   cd client\api; <wrangler> secret delete ORCHESTRATOR_PRIVATE_KEY
   ```
2. In the Alchemy dashboard, delete or rotate the Base Sepolia app whose key was in `ORCHESTRATOR_CHAIN_WSS_URL`.
3. Stop using wallet `0xF29283Dc81D7Ff69AE6B592d86682Bfb998Ac61A` for anything. Don't send it funds.

## 2. Set the API Worker secrets (10 min)
Each command generates a random value and pipes it straight into Cloudflare, so you never see or copy it.
```powershell
cd client\api
# 2a. Node instruction signer (not a wallet; holds no funds)
node -e "process.stdout.write('0x'+require('crypto').randomBytes(32).toString('hex'))" | <wrangler> secret put INSTRUCTION_SIGNING_KEY
# 2b. Internal key shared by the API and the keeper. Keep $k in this window for step 5.
$k = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
$k | <wrangler> secret put INTERNAL_API_KEY
# 2c. Rotate the sign-in secret (signs everyone out once)
node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))" | <wrangler> secret put JWT_SECRET
```
Then open https://api.cloudana.io/v1/nodes/instruction-key and **send Claude the `address` it shows**. It's public. Claude bakes it into the node agent and DaemonSet.

## 3. Create the Safe and the two fresh keys (20 min)
In a wallet you trust, ideally a hardware wallet, on **Base Sepolia**:
1. **Safe:** go to https://app.safe.global → Create → network **Base Sepolia**.
   - Owners: 3 addresses you control (e.g. hardware wallet + 2 other wallets). Threshold **2**.
   - This one Safe is the admin, treasury and guardian for testnet. Later, give the guardian role a signer who isn't you.
2. **Deployer:** create a brand-new account, used only once to deploy. Fund it with ~0.02 Base Sepolia ETH from a faucet (Coinbase CDP faucet or Alchemy faucet).
3. **Poster:** create another brand-new account; the keeper uses it to post epochs. Fund it with ~0.05 Base Sepolia ETH.

**Send Claude:** the Safe address and the poster **address** (public). Never the keys.

## 4. Deploy the v2 contracts (10 min)
Put the deployer key in `contract\.env` as `PRIVATE_KEY=0x…`. This file is gitignored; check with `git check-ignore contract/.env`.
```powershell
cd contract
$env:TREASURY_SAFE="0xYourSafe"; $env:GUARDIAN_SAFE="0xYourSafe"; $env:ADMIN_SAFE="0xYourSafe"
$env:POSTER_ADDRESS="0xYourPoster"
$env:GENESIS_TIMESTAMP="1791331200"   # 2026-10-07 00:00 UTC: first hourly epoch of the new API; covers everything it has recorded
npx hardhat run scripts/v2/deploy.ts --network baseSepolia
```
It prints two `npx hardhat verify …` commands. Run them so Basescan shows the source. It also writes the new addresses into `shared/addresses.baseSepolia.json`.

Afterwards the deployer holds no roles (the script asserts it). Delete `PRIVATE_KEY` from `contract\.env`.

**Send Claude:** "contracts deployed". Claude commits the address file and wires `SETTLEMENT_ADDRESS` into the API and keeper.

## 5. Deploy the keeper (10 min, after Claude wires the address)
```powershell
cd keeper
npm install
<wrangler> secret put POSTER_PRIVATE_KEY      # paste the poster key at the hidden prompt
$k | <wrangler> secret put INTERNAL_API_KEY    # the same $k from step 2b (re-generate both if that window is closed)
<wrangler> deploy
```
Check `https://cloudana-keeper.amraldabbas19.workers.dev/health`. It should show your settlement address and the poster's balance.

## 6. Fund the testnet escrow (10 min)
Testnet credits are off-chain, so the settlement needs CLD in escrow before it can burn fees. Without it the keeper reports *"fees exceed free escrow"* and nothing settles.
In the Safe, use the Transaction Builder to make two calls in one batch:
1. `CLDTokenV2.approve(<settlement>, 10000000000000000000000)` (10,000 CLD)
2. `CloudanaSettlementV2.deposit(10000000000000000000000)`

Top it up when `/health` or the console shows escrow running low.

## 7. Email addresses (10 min)
Cloudflare dashboard → cloudana.io → **Email** → Email Routing.
- Enable it.
- Add `privacy@cloudana.io` and `abuse@cloudana.io`, forwarding to your inbox.

The terms and privacy pages already link to both.

## 8. Hosting gateway (optional until the first hosting node; ~$10/mo)
`*.sites.cloudana.io` is one level below the free Universal certificate, so it needs **Advanced Certificate Manager** (or Total TLS) on the zone.
1. Dashboard → SSL/TLS → Edge Certificates → order an advanced certificate covering `*.sites.cloudana.io`.
2. DNS → add a **proxied** record: `AAAA *.sites 100::`.
3. Tell Claude. Claude uncomments the route in `gateway/wrangler.toml` and deploys it.

## 9. Node agent image (2 min, after Claude bakes in the signer)
The first push of `node-agent/**` to `main` publishes `ghcr.io/amrdab/cloudana-node-agent`. Then make it public so nodes can pull it without logging in:
GitHub → your profile → Packages → `cloudana-node-agent` → Package settings → Change visibility → **Public**.

## 10. Your workstation as node #1 (when it's ready)
- Home hardware runs **compute (matmul) and static hosting only**; containers and GPU workstations stay off until a datacenter fleet node is hardened.
- Forward TCP **42000–42100** on your router to the workstation, so hosted sites are reachable from your public IP.
- Run the agent (Claude will give you the exact one-liner with the signer address), open the bind link it prints, and sign with your wallet.

## 11. Before anything has real value
- Engage counsel on token classification, payment flows and the free tier.
- Audit the v2 contracts.
- Add a guardian signer who isn't you, and put a 48 h timelock on admin.
- Revisit the mainnet parameters in `docs/DECISIONS_CONSENSUS.md`. Note the sim's warning: the 1,000 µCLD base fee needs re-pricing if CLD trades far above $0.10.
