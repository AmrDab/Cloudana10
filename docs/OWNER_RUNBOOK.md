# Owner runbook: what's left for you (updated 2026-10-21)

Claude has done everything that doesn't need your keys, accounts, signature or money. **Live today:**

- the API (`api.cloudana.io`), the console (`app.cloudana.io`) and the site (`cloudana.io`), with API keys, sealed
  secrets, node drain/resume, container logs and signed public records;
- the relay (`relay.cloudana.io`) and the hosting gateway: every deployment is served at `https://<id>.cloudana.run`;
- the node-agent image 1.6.0 (public on GitHub) and **node #1**, an Azure VM running it (compute, hosting and storage);
- all five Worker secrets (set by you on 2026-10-18).

What's left needs **you**: your wallets, your accounts, your money or your decision. Each step has four parts:

- **Why:** what the step is for, in plain English.
- **Do:** exactly what to click or paste.
- **You should see:** how you know it worked.
- **If it goes wrong:** the usual problems and what to do.

Work top to bottom. When a step says **Tell Claude**, send that sentence in chat. Claude does its part and tells you
when the next step is ready.

---

## Checklist

| ✔ | Step | Time | Needs | Tell Claude |
|---|---|---|---|---|
| ☐ | A. Six decisions (in chat) | 10 min | — | your answers, or "go with your recommendations" |
| ☐ | 0. Set up PowerShell | 5 min | — | — |
| ☐ | 1. Kill the old Alchemy key (skip if you already did) | 5 min | Alchemy login | "Alchemy done" |
| ✔ | 2. Three API secrets | — | done 2026-10-18 | — |
| ☐ | 3. MetaMask, five accounts, test ETH, a Safe | 30 min | Browser | the Safe and Poster addresses |
| ☐ | 4. Deploy the contracts (after decision A1) | 15 min | Deployer key | "contracts deployed" |
| ☐ | 5. Switch on the keeper (after Claude says ready) | 10 min | Poster key | "keeper secrets done" |
| ☐ | 6. Fund the escrow | 10 min | Safe owners 1 and 2 | "escrow funded" |
| ☐ | 7. Email aliases privacy@ and abuse@ | 5 min | Microsoft 365 admin | "aliases done" |
| ✔ | 8. Relay secrets and the `cloudana.run` domain | — | done 2026-10-18 | — |
| ✔ | 9. Node image public | — | done 2026-10-18 | — |
| ☐ | 10. A container / GPU node | later | a suitable machine | "GPU node ready" |
| ☐ | 11. DMCA agent and dmca@ (~$6) | 20 min, before storage phase 2 | copyright.gov account, Microsoft 365 admin | "DMCA agent registered" |
| ☐ | 12. Confirm the Cloudflare plan | 2 min | Cloudflare login | "plan is Free" or "plan is Paid" |

Steps 1, 7, 11 and 12 don't depend on anything else; do them whenever you have a few minutes. Steps 3 → 4 → 5 → 6
must go in that order, and step 4 waits for your answer to decision A1.

---

## Golden rules

1. A **private key** (`0x` + 64 characters) or your **12-word recovery phrase** never goes into chat, email,
   screenshots, GitHub or any file, except the two places this guide names: `contract\.env` in step 4 (deleted right
   after) and the hidden prompt in step 5. Claude will never ask for one.
2. **Never run `scripts\set-api-secrets.mjs` again**, with or without `--rotate`. Its three secrets are set. Replacing
   one cuts off every node (`INSTRUCTION_SIGNING_KEY`), signs everyone out (`JWT_SECRET`) or makes stored data
   unverifiable (`STORAGE_KEK`). If something ever seems to need it, ask Claude first.
3. Run `scripts\set-relay-secrets.mjs` **only in step 5**. Every run replaces both relay secrets, and hosting blinks
   for about a minute while it does.
4. Never type `wr secret put INTERNAL_API_KEY` (or any secret the scripts manage) by hand. A hand-typed value goes to
   one Worker only, and the others stop trusting it.
5. Never send anything to, or give any role to, the old wallet `0xF29283Dc81D7Ff69AE6B592d86682Bfb998Ac61A`. Its key
   is public.

---

## Words you'll meet

| Word | Meaning |
|---|---|
| **Wallet / account** | An identity on the blockchain. It has a public **address** and a secret **private key**. |
| **Address** | `0x` + 40 characters (42 in total). Public, like an IBAN. Safe to share. |
| **Private key** | `0x` + 64 characters (66 in total). Whoever has it controls the wallet. **Never share it.** |
| **Recovery phrase** | 12 words that regenerate *all* your MetaMask accounts. Write it on paper; never type it anywhere except MetaMask. |
| **Base Sepolia** | Coinbase's **test** blockchain (chain ID 84532). Its ETH and CLD have **no real value**, so mistakes cost nothing. |
| **Test ETH** | Free "gas money" from a faucet, used to pay for test transactions. |
| **Safe** | A shared wallet that needs 2 of 3 owners to approve anything. It controls Cloudana's treasury and contracts. |
| **Contract** | A program on the blockchain. You deploy two: the CLD token and the settlement contract. |
| **Escrow** | CLD parked in the settlement contract so it can burn fees when it settles. |
| **Keeper** | A small robot (a Cloudflare Worker) that posts the hourly settlement to the contract and pays everyone, using the Poster wallet. |
| **Worker secret** | A value stored inside a Cloudflare Worker that nobody can read back, not even you. |
| **PowerShell** | The Windows command window. You paste commands into it and press Enter. |

---

## A. Six decisions (answer in chat, 10 min)

Claude's recommendation is marked ★. Reply with your choice for each, or just **"go with your recommendations"**.
Only **A1** blocks anything (step 4); the rest steer what Claude builds next.

**A1. How the subsidy pool is counted — before the contracts are deployed.**
Besides their 95 % of each fee, providers get a small subsidy ("lane B", up to 4 % of the fee) from a budget.
- ★ **Per hour (as today).** Each hourly settlement has its own budget; when it's over budget, everyone in that hour
  is scaled down equally. Already built, tested and matching the contract. Nothing to change.
- **Per week.** One weekly budget smooths out busy and quiet hours, but the settlement contract caps the subsidy per
  hour, so it needs a contract change, new tests and an audit pass *before* step 4.

**A2. How much work gets re-checked in full (backlog B-6).**
Today every job's result is checked with a fast maths test (Freivalds), and the full replay of its proof runs on
every job. The replay is the expensive part.
- ★ **Replay 1 job in 10 at random, and hold each job's pay for 24 hours.** If a sampled job fails, the provider's
  held pay is taken back (clawed) and the node is flagged. Cuts the API's checking cost about 10×. A cheater is
  caught within about 10 jobs and loses the pay of every job still on hold.
- **Keep replaying every job.** Safest, but costs grow with traffic, and Cloudflare bills for that CPU time.
- **Another rate** (1 in 5, 1 in 20) or another hold time.

**A3. The old console pages under `/control/legacy` (backlog B-3).**
- ★ **Remove them all.** Several already fail, because they call API routes that no longer exist. The pricing
  calculator and the "decentralization" page come back later as rewritten pages in the main console.
- **Keep some.** Name which ones.

**A4. Fleet pinning (backlog B-9).** Should a customer be able to say "only run this on fleet X"?
- ★ **Yes:** their own fleet, or a partner fleet chosen by its fleet ID shown in the console. Never a single node,
  so the network still decides which machine runs it.
- **Own fleet only.**
- **Not at all.**

**A5. Direct-connection nodes (backlog B-13).** Nodes can connect out through the relay (no open ports) or take
connections directly on a public IP.
- ★ **Relay by default; keep direct mode only for GPU workstations** until the relay can carry their live sessions
  (Jupyter, code-server), then retire it.
- **Retire direct mode now.** GPU workstations stop working until that relay feature exists.

**A6. The Azure VM's subscription.** Node #1 runs on your *Azure for Students* credit. Those terms restrict
cryptocurrency mining, and a node that earns CLD could be read that way, even though testnet CLD has no value.
Claude isn't a lawyer; this is a risk call for you.
- ★ **Keep it on Students credit while CLD is test-only, and move it to pay-as-you-go (~$30/month for this size)
  before CLD has any value.**
- **Move it now.** In the Azure portal: **Subscriptions → Add → Pay-As-You-Go**, then on the resource group
  `cloudana-node` choose **Move → to another subscription**. Tell Claude; it checks the node afterwards.
- **Shut it down.** Tell Claude; it stops the VM so the credit stops being spent.

✅ Tell Claude: your six answers, or **"go with your recommendations"**.

---

## Step 0: Set up PowerShell (each time you open a new window)

**Why:** the steps run commands from a project folder, using Cloudflare's tool `wrangler`. Claude made you your own
copy, `C:\Users\amr_d\Cloudana10-owner`. Use only this folder. Claude works in another one, and your older
`C:\Users\amr_d\Cloudana10` copy is out of date.

**Do:**
1. Press the **Windows key**, type `powershell` and click **Windows PowerShell**. A blue or black window opens.
2. Paste each line below and press **Enter** after each. To paste in PowerShell, right-click or press Ctrl+V.
   ```powershell
   cd C:\Users\amr_d\Cloudana10-owner
   git fetch origin
   git switch --detach origin/main
   function wr { node "$env:LOCALAPPDATA\npm-cache\_npx\32026684e21afda6\node_modules\wrangler\bin\wrangler.js" @args }
   wr whoami
   ```

**You should see:**
- `git switch` prints `HEAD is now at …` (that's the newest version).
- `wr whoami` prints `You are logged in … amraldabbas19@gmail.com` and a table with your account.

**If it goes wrong:**
- `cd : Cannot find path` → the folder name is mistyped. Copy it exactly.
- `git switch` says *your local changes would be overwritten* → you edited a file in this folder. Tell Claude;
  don't force anything.
- `wr whoami` says *not logged in* → run `wr login`. A browser opens; click **Allow**, then run `wr whoami` again.
- `wr : The term 'wr' is not recognized` → you're in a new window. Paste the `function wr …` line again.

---

## Step 1: Kill the old Alchemy key (5 min; skip if you did it already)

**Why:** the file that leaked in March also contained an Alchemy link with a key inside. Anyone can spend your
Alchemy quota with it.

**Do:**
1. Go to https://dashboard.alchemy.com and sign in.
2. In the left menu click **Apps**. Look for an app on **Base Sepolia**.
3. Click it. If you no longer use it, click **Delete app** (under ⋮ or *Settings*) and confirm.
4. If you still use it, click **API Key → Regenerate** instead.

**You should see:** the app is gone from the list, or it shows a new key.

**If it goes wrong:** there's no Base Sepolia app? Nothing to do; the link pointed to an app that's already gone.

✅ Tell Claude: **"Alchemy done."**

---

## Step 3: MetaMask, five accounts, test ETH and a Safe (30 min)

**Why:** Cloudana's treasury and admin rights belong to a **Safe**, a shared wallet needing 2 of 3 approvals, so no
single lost or stolen key can drain or hijack it. Two more single-purpose wallets do the one-time deploy and the
hourly posting.

### 3a. Install MetaMask
1. In Chrome or Edge, go to **https://metamask.io → Download** and add the extension. Pin it: click the puzzle
   icon in the toolbar, then the pin next to MetaMask.
2. Click **Create a new wallet** and set a strong password.
3. MetaMask shows **12 words**. Write them on paper, in order, and keep the paper somewhere safe. Never type them
   into a website, and never photograph them.
4. Confirm the words when asked.

### 3b. Add the Base Sepolia test network
1. Go to **https://chainlist.org**.
2. Turn on **Include Testnets** (a toggle near the search box).
3. Search **Base Sepolia** and check that the chain ID is **84532**.
4. Click **Connect Wallet** and approve in MetaMask. Then click **Add to MetaMask** and approve.

**You should see:** MetaMask's network selector (top left) offers **Base Sepolia**. Select it.

### 3c. Create five accounts
1. In MetaMask, click the account name at the top, then **+ Add account or hardware wallet → Add a new account**.
2. Repeat until you have five accounts.
3. Rename each one: open the account's **⋮** menu, choose **Account details** and click ✏️ next to the name.

| Name | Purpose | Test ETH needed |
|---|---|---|
| Safe Owner 1 | approves Safe transactions | ~0.01 |
| Safe Owner 2 | approves Safe transactions | ~0.005 |
| Safe Owner 3 | backup approver | 0 |
| Deployer | deploys the contracts once | ~0.02 |
| Poster | the keeper's wallet; posts every hour | ~0.05 (top it up now and then) |

(A hardware wallet such as a Ledger as Owner 3 is better, but not needed on testnet.)

### 3d. Get free test ETH
1. Click an account's name to **copy its address** (`0x…`).
2. Open a faucet and paste the address:
   - **Coinbase:** https://portal.cdp.coinbase.com/products/faucet (sign in with a free Coinbase account, choose
     **Base Sepolia** and **ETH**);
   - **Alchemy:** https://www.alchemy.com/faucets/base-sepolia.
3. Repeat for **Deployer**, **Poster**, **Safe Owner 1** and **Safe Owner 2**.

**You should see:** a balance such as `0.05 SepoliaETH` within a minute (with MetaMask on Base Sepolia).

**If it goes wrong:**
- *Already claimed today* → use the other faucet, or wait 24 hours.
- The balance stays 0 → you're looking at the wrong network. Switch to Base Sepolia, top left.
- A faucet asks you to prove you hold mainnet ETH → use the other faucet.

### 3e. Create the Safe
1. Go to **https://app.safe.global**, click **Connect wallet → MetaMask** and choose **Safe Owner 1**.
2. Click **Create account**.
3. **Network:** Base Sepolia. **Name:** `Cloudana Testnet`. Click **Next**.
4. **Signers:** paste the addresses of Safe Owner 1, 2 and 3 (**+ Add new signer** adds rows).
5. **Threshold:** `2` out of 3. Click **Next**, review, click **Create account** and approve in MetaMask.
6. When it says the account is ready, click the Safe's name at the top left to copy its address. It looks like
   `basesep:0x…`; keep only the part from `0x`.

**You should see:** your Safe's dashboard with a 0 balance, and three signers under **Settings → Setup**.

✅ Tell Claude: **"Safe is 0x… and Poster is 0x…"** (two addresses, both public).

---

## Step 4: Deploy the contracts (15 min; after decision A1)

**Why:** this puts the new CLD token and the settlement contract on Base Sepolia, controlled by your Safe. They
replace the old contracts, whose key leaked.

**Do:**
1. **Copy the Deployer's private key:** in MetaMask, select **Deployer**, open **⋮ → Account details → Show private
   key**, enter your MetaMask password, hold the button, and copy the key (66 characters, starting with `0x`).
2. **Put it in a private file.** In PowerShell (after step 0):
   ```powershell
   cd contract
   git check-ignore .env
   ```
   This must print `.env`, meaning Git will never upload the file. If it prints nothing, **stop** and tell Claude.
   ```powershell
   notepad .env
   ```
   Notepad asks *"Do you want to create a new file?"*; click **Yes**. Type `PRIVATE_KEY=`, paste the key right after
   it with no spaces or quotes, save (Ctrl+S) and close Notepad.
3. **Install the contract tools** (the first time only; one or two minutes):
   ```powershell
   npm ci
   ```
4. **Deploy.** First copy this block into a *new* Notepad window (not `.env`) and replace both `0xYour…`
   placeholders with your real Safe and Poster addresses. Then paste the whole block into PowerShell:
   ```powershell
   $env:TREASURY_SAFE="0xYourSafeAddress"
   $env:GUARDIAN_SAFE=$env:TREASURY_SAFE
   $env:ADMIN_SAFE=$env:TREASURY_SAFE
   $env:POSTER_ADDRESS="0xYourPosterAddress"
   $env:GENESIS_TIMESTAMP="1791331200"
   npx hardhat run scripts/v2/deploy.ts --network baseSepolia
   ```
   `GENESIS_TIMESTAMP` is 7 Oct 2026, 00:00 UTC. Every hour the API has recorded since then can be settled; nothing
   is lost.
5. **Remove the key from the file straight away:**
   ```powershell
   notepad .env
   ```
   Delete everything in it, save and close. Then go back to the project folder with `cd ..`

**You should see** after about a minute, lines like:
```
CLDTokenV2            0x…
CloudanaSettlementV2  0x…  (genesisEpoch 497592)
token roles: minter=settlement admin=0x…(your Safe) deployer=none
wrote shared/addresses.baseSepolia.json …
```
followed by two `npx hardhat verify …` lines. Skip those; they only publish the source code on Basescan.
`deployer=none` matters: after deploying, the Deployer keeps no power at all.

**If it goes wrong:**
- `insufficient funds` → the Deployer needs more test ETH (step 3d).
- `invalid private key` or `HH8` → the `.env` line is wrong. It must be exactly `PRIVATE_KEY=0x…`, with no quotes or
  spaces.
- `TREASURY_SAFE must be set to an address` → a placeholder is still there, or you opened a new window. Paste the
  `$env:` lines again with the real addresses.
- `no deployer: set PRIVATE_KEY` → `.env` is empty or saved somewhere else. It must be `contract\.env`.
- `429` / `rate limited` / `timeout` → the free public network endpoint is busy. Wait a minute and run the `npx
  hardhat run …` line again. It's safe: a failed run deploys nothing.
- Anything else: copy the red error text to Claude (never the key).

✅ Tell Claude: **"contracts deployed"**. Claude reads the new addresses from
`C:\Users\amr_d\Cloudana10-owner\shared\addresses.baseSepolia.json` and then:
- points the API and the keeper at the new contracts;
- deploys the keeper Worker;
- tells you **"ready for step 5"**, along with the token and settlement addresses you need in step 6.

---

## Step 5: Switch on the keeper (10 min; after Claude says "ready for step 5")

**Why:** every hour the API totals who earned what. The keeper posts that batch to the settlement contract and then
pays everyone. It signs with the **Poster** wallet, so it needs the Poster's key. It also needs the API's internal
key, which the relay script hands to every Worker that uses it, the keeper included.

**Do** (PowerShell after step 0, one line at a time):
1. Give the keeper the Poster's key:
   ```powershell
   cd keeper
   wr secret put POSTER_PRIVATE_KEY
   ```
   It asks **"Enter a secret value:"**. In MetaMask, select **Poster**, open **⋮ → Account details → Show private
   key**, and copy the key. Paste it at the prompt (nothing appears as you paste; that's normal) and press **Enter**.
2. Hand the internal key to the keeper, and refresh it on the API, relay and gateway in the same run:
   ```powershell
   cd ..
   node scripts\set-relay-secrets.mjs
   ```
   This replaces both relay secrets everywhere at once. Sites at `*.cloudana.run` may fail for about a minute while
   node #1 reconnects; that's expected.

**You should see:**
- After 1: `✨ Success! Uploaded secret POSTER_PRIVATE_KEY`.
- After 2: a `Setting … on …` line followed by `✨ Success! Uploaded secret …` for `cloudana-api`, `cloudana-relay`,
  `cloudana-gateway` **and `cloudana-keeper`**, then `Done.` There must be no "skipped" line for the keeper.
- Five minutes later, https://cloudana-keeper.amraldabbas19.workers.dev/health shows your new settlement address
  under `"settlement"`, a `posterBalanceEth` above 0, and no `healthError`.

**If it goes wrong:**
- `INTERNAL_API_KEY → cloudana-keeper: not deployed yet, skipped` → Claude hasn't deployed the keeper yet. Wait for "ready for step 5",
  then run step 2 again (running it again is fine).
- `/health` mentions `401` or `unauthorized` from the API → the keeper missed the internal key. Run
  `node scripts\set-relay-secrets.mjs` once more. Never set `INTERNAL_API_KEY` by hand.
- `posterBalanceEth: "0"` → fund the Poster (step 3d).
- The script stops halfway with an error → run it again. Hosting stays down until one run finishes completely.

✅ Tell Claude: **"keeper secrets done"**. Claude checks the keeper, the node and a live site.

---

## Step 6: Fund the escrow (10 min)

**Why:** the token contract minted **1,000,000 test CLD** to your Safe. Credits in the console are tracked
off-chain, so the settlement contract needs real (test) CLD parked in it to burn when it settles fees. Without it
the keeper says *"fees exceed free escrow"* and nobody gets paid.

You'll create **two actions in one batch**:
- `approve` lets the settlement contract take CLD from the Safe;
- `deposit` moves 10,000 CLD into it.

Claude gives you both addresses (token and settlement) with "ready for step 5".

**Do:**
1. Go to https://app.safe.global, select the **Cloudana Testnet** Safe and check that it holds **1,000,000 CLD**
   (under **Assets**; you may need to switch on "show all tokens").
2. In the left menu click **Apps**, search **Transaction Builder** and open it.
3. **First action (approve):**
   - **Enter Address:** the **CLD token address**.
   - If a box asks for an **ABI**, paste:
     ```json
     [{"type":"function","name":"approve","stateMutability":"nonpayable","inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],"outputs":[{"type":"bool"}]}]
     ```
   - **Contract Method:** `approve`.
   - **spender:** the **settlement address**.
   - **amount:** `10000000000000000000000` (10,000 followed by 18 zeros, because CLD has 18 decimals).
   - Click **Add transaction**.
4. **Second action (deposit):**
   - **Enter Address:** the **settlement address**.
   - ABI, if asked:
     ```json
     [{"type":"function","name":"deposit","stateMutability":"nonpayable","inputs":[{"name":"amount","type":"uint256"}],"outputs":[]}]
     ```
   - **Method:** `deposit`, **amount:** `10000000000000000000000`.
   - Click **Add transaction**.
5. Click **Create Batch → Send Batch → Sign** (MetaMask on Safe Owner 1).
6. In MetaMask switch to **Safe Owner 2** and reload the Safe page. Open **Transactions → Queue**, click the batch,
   then **Confirm**, and finally **Execute**.

**You should see:** the transaction moves to **History** as *Success*, and the Safe's CLD balance drops to 990,000.

**If it goes wrong:**
- A *"Transaction will fail"* warning → check that the amount has exactly 23 digits and that the addresses aren't
  swapped (approve goes to the token, deposit goes to the settlement contract).
- **Execute** is greyed out → the second owner hasn't confirmed yet.
- Owner 2 has no ETH for the execute fee → top it up (step 3d).

✅ Tell Claude: **"escrow funded"**. Claude then runs a paid test job and watches the first hourly batch go through:
API → keeper → contract → provider.

---

## Step 7: Email aliases privacy@ and abuse@ (5 min)

**Why:** the Terms and Privacy pages tell people to write to `privacy@cloudana.io` and `abuse@cloudana.io`. Your
cloudana.io email runs on **Microsoft 365**, so add them there as free aliases. (Claude deliberately didn't switch on
Cloudflare's email routing; it would have broken your inbox.)

**Do:**
1. Go to **https://admin.microsoft.com** and sign in with your Microsoft 365 admin account.
2. In the left menu open **Users → Active users** and click your own name.
3. On the **Account** tab, find **Aliases** and click **Manage username and email**.
4. Under **Aliases**, type `privacy`, check that the domain dropdown says `cloudana.io`, click **Add**, then **Save
   changes**.
5. Repeat for `abuse`.

**You should see:** both aliases listed. Within about 15 minutes, a test email from your Gmail to
`abuse@cloudana.io` arrives in your Outlook inbox.

**If it goes wrong:** you have no admin rights → whoever set up Microsoft 365 for cloudana.io has to add them.

✅ Tell Claude: **"aliases done"**.

---

## Step 10: A container / GPU node (later, when you have the machine)

Node #1 (Azure) runs compute jobs, static sites and storage. Containers, GPU endpoints and GPU workstations need a
machine with:
- Linux (on Windows: WSL2 Ubuntu, not Docker Desktop), **Docker 28 or newer**;
- a dedicated disk area with project quotas (xfs `pquota`), so a customer's container can't fill your disk;
- for GPU work, an NVIDIA GPU with current drivers and the NVIDIA container toolkit.

Tell Claude **"GPU node ready"**, with its operating system, the GPU model and whether it should take GPU endpoints
(customers' own inference images). You'll get:
1. one install command, pre-filled with the right settings (including `CLOUDANA_ANY_IMAGE=1` for an endpoint node);
2. a bind link the agent prints. Open it, connect MetaMask (any account: your earnings go there) and sign.

**No router changes:** the node connects out to the relay, so there are no ports to forward.

Home machines run **compute jobs and static websites only**. Containers and GPU rentals run only on a properly
hardened node. That's a security decision, not a bug.

---

## Step 11: A DMCA agent and dmca@ (20 min, ~$6; before storage phase 2 opens)

**Why:** storage phase 2 lets customers keep files on Cloudana. Cloudana holds the keys, so legally it is the host.
To be protected from copyright claims over files customers upload, a US host must have a **designated agent** listed
with the US Copyright Office and act on notices. You decided this on 2026-10-15; storage phase 2 doesn't open until
it's done. A lawyer should look at the notice-and-takedown page before then (Claude drafts it).

**Do:**
1. Go to **https://dmca.copyright.gov** (the official DMCA Designated Agent Directory) and create an account.
2. Register **Cloudana** as the service provider. Enter the legal name you operate under (your company, or yourself
   if there's no company yet), its address, and the alternate names `Cloudana` and `cloudana.io`.
3. For the agent, enter your name (or a role such as "Copyright Agent"), a mailing address, a phone number and the
   email `dmca@cloudana.io`.
4. Pay the $6 fee. The designation lasts 3 years; the site emails you before it expires.
5. In Microsoft 365, add the alias `dmca` the same way as in step 7.

**You should see:** your entry in the public directory, and a test email to `dmca@cloudana.io` landing in your inbox.

✅ Tell Claude: **"DMCA agent registered"**.

---

## Step 12: Confirm the Cloudflare plan (2 min)

**Why:** on the free Workers plan, Cloudflare caps daily database and storage operations, CPU time per request and
backups (7 days instead of 30). Usage this week (about 9,000 key-value writes a day, above the free cap of 1,000)
suggests you're already on **Workers Paid** ($5/month). Confirm it, because the limits change how Claude sizes
things.

**Do:**
1. Go to **https://dash.cloudflare.com** and open your account.
2. In the left menu click **Workers & Pages**, then **Plans** (sometimes under **Overview → Plan**).

**You should see:** **Workers Paid** or **Workers Free**.

**If it says Free:** upgrade to **Workers Paid** before more nodes join or before launch (it's a purchase, so only
you can do it). Nothing is broken today.

✅ Tell Claude: **"plan is Paid"** or **"plan is Free"**.

---

## Done (for reference; don't repeat)

**Step 2: API secrets (2026-10-18).** `INSTRUCTION_SIGNING_KEY`, `JWT_SECRET` and `STORAGE_KEK` on `cloudana-api`.
The public half of the instruction key is `0x90ece35D6877658e9F3dAd7251b3b5654dd2a247`
(https://api.cloudana.io/v1/nodes/instruction-key); every agent has it built in. Replacing any of the three is a
deliberate, owner-approved operation (`DEPLOYMENT_RUNBOOK.md` §1). See golden rule 2.

**Step 8: relay secrets and the user-content domain (2026-10-18).**
- **Secrets:** `RELAY_TICKET_SECRET` on api + relay, and `INTERNAL_API_KEY` on api + gateway. The keeper gets the
  internal key in step 5.
- **Domain:** `cloudana.run`, bought at Cloudflare, with a proxied wildcard record (`*` AAAA `100::`). Every
  deployment is served at `https://<id>.cloudana.run`.

**Step 9: the node image is public (2026-10-18).** `ghcr.io/amrdab/cloudana-node-agent`, now at 1.6.0.

---

## Later: before CLD has any real value

Not needed on testnet, but don't skip any of these before mainnet:
- a lawyer reviews the token, the payments and the Terms;
- a professional audit of the two v2 contracts;
- a guardian signer who isn't you, and a 48-hour delay on admin changes;
- move node #1 off student credit (decision A6);
- re-check the mainnet numbers in `docs/DECISIONS_CONSENSUS.md`.

When customers want their own domains for sites (`www.theirshop.com`), Claude will ask you to switch on **Cloudflare
for SaaS** on `cloudana.run` (backlog B-15). It's free for the first 100 domains, but it's a setting on your account.

---

## Anytime: download your waitlist

Sign-ups are stored in Cloudana's own database (Cloudflare D1, the same one the API uses), and it's backed up
automatically. Cloudflare's *Time Travel* can restore any point in the last 30 days on Workers Paid (7 on Free).

To download everyone as a spreadsheet, open PowerShell (step 0) and paste:
```powershell
cd client\api
$rows = wr d1 execute cloudana-db --remote --json --command "SELECT datetime(created_at/1000,'unixepoch') AS joined_utc, email, role, newsletter, ref_code, referred_by, country, company FROM waitlist ORDER BY created_at" 2>$null | ConvertFrom-Json | ForEach-Object { $_.results }
if ($rows) { $rows | Export-Csv "$HOME\Desktop\cloudana-waitlist.csv" -NoTypeInformation; "Saved $(@($rows).Count) sign-ups to your Desktop" } else { "No sign-ups yet." }
cd ..\..
```
**You should see:** `Saved N sign-ups to your Desktop` and a file `cloudana-waitlist.csv` there (open it with Excel),
or `No sign-ups yet.`
- `newsletter` = 1 means they agreed to receive emails.
- `referred_by` is the code of whoever referred them.

Only email people with `newsletter = 1`, and honour unsubscribe requests: the privacy page promises both.
