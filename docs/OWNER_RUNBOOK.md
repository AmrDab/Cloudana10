# Owner runbook: testnet go-live (beginner edition)

Claude has already done everything that doesn't need your keys, accounts or signature:

- deleted the leaked old key from the API;
- deployed the new API, both websites and the hosting gateway Worker;
- published the node-agent image.

What's left needs **you**, because it involves your wallets, your accounts or your money. Each step below has four parts:

- **Why:** what the step is for, in plain English.
- **Do:** exactly what to click or paste.
- **You should see:** how you know it worked.
- **If it goes wrong:** the common problems and what to do.

Work top to bottom. Steps 1–6 make testnet *operational*; 7–9 are polish; 10 is when your workstation is ready.

---

## Checklist

| ✔ | Step | Time | Needs | Tell Claude |
|---|---|---|---|---|
| ☐ | 0. Set up PowerShell | 5 min | — | — |
| ☐ | 1. Kill the old Alchemy key | 5 min | Alchemy login | "Alchemy done" |
| ☐ | 2. Two API secrets | 5 min | PowerShell | the `0x…` address from the link |
| ☐ | 3. MetaMask, 5 accounts, test ETH, Safe | 30 min | Browser | Safe + Poster addresses |
| ☐ | 4. Deploy the contracts | 10 min | Deployer key | "contracts deployed" |
| ☐ | 5. Turn on the keeper | 10 min | Poster key | "keeper deployed" |
| ☐ | 6. Fund the escrow | 10 min | Safe owners 1 + 2 | "escrow funded" |
| ☐ | 7. Email aliases | 5 min | Microsoft 365 admin | "aliases done" |
| ☐ | 8. Hosting DNS + certificate (~$10/mo, optional for now) | 10 min | Cloudflare login | "sites done" |
| ☐ | 9. Make the node image public | 2 min | GitHub login | "image public" |
| ☐ | 10. Your workstation as node #1 | later | Your router | "workstation ready" |

---

## Words you'll meet

| Word | Meaning |
|---|---|
| **Wallet / account** | An identity on the blockchain. It has a public **address** and a secret **private key**. |
| **Address** | `0x` + 40 characters (42 total). Public, like an IBAN. Safe to share. |
| **Private key** | `0x` + 64 characters (66 total). Whoever has it controls the wallet. **Never share it.** |
| **Recovery phrase** | 12 words that regenerate *all* your MetaMask accounts. Write it on paper; never type it anywhere except MetaMask. |
| **Base Sepolia** | Coinbase's **test** blockchain. Its ETH and CLD have **no real value**, so mistakes cost nothing. |
| **Test ETH** | Free "gas money" from a faucet, used to pay for test transactions. |
| **Safe** | A shared wallet that needs 2 of 3 owners to approve anything. It controls Cloudana's treasury and contracts. |
| **Contract** | A program on the blockchain. You deploy two: the CLD token and the settlement contract. |
| **Escrow** | CLD parked in the settlement contract so it can burn fees when settling. |
| **Keeper** | A small robot (Cloudflare Worker) that posts settlement batches every hour, using the Poster wallet. |
| **Secret (Cloudflare)** | A value stored inside a Cloudflare Worker that nobody can read back, not even you. |
| **PowerShell** | The Windows command window. You paste commands into it and press Enter. |

> **Golden rule:** a private key (66 characters) never goes into chat, email, screenshots, GitHub, or any file except the two places this guide names (step 4 `.env`, step 5 prompt).

---

## Step 0: Set up PowerShell (do this every time you open a new window)

**Why:** every step runs commands from the Cloudana project folder, using Cloudflare's tool `wrangler`.

**Do:**
1. Press the **Windows key**, type `powershell`, and click **Windows PowerShell**. A blue or black window opens.
2. Paste each line below and press **Enter** after each. To paste in PowerShell, right-click or press Ctrl+V.
   ```powershell
   cd C:\Users\amr_d\Cloudana10-site
   git pull
   function wr { node "$env:LOCALAPPDATA\npm-cache\_npx\32026684e21afda6\node_modules\wrangler\bin\wrangler.js" @args }
   wr whoami
   ```

**You should see:**
- `git pull` prints `Already up to date.` or a list of updated files.
- `wr whoami` prints `You are logged in … amraldabbas19@gmail.com` and a table with your account.

**If it goes wrong:**
- `cd : Cannot find path` → the folder name is mistyped. Copy it exactly.
- `wr whoami` says *not logged in*: run `wr login`, a browser opens, click **Allow**, then run `wr whoami` again.
- `wr : The term 'wr' is not recognized` → you opened a new window; paste the `function wr …` line again.

---

## Step 1: Kill the old Alchemy key (5 min)

**Why:** the file that leaked in March also contained an Alchemy link with a key inside. Anyone can use it on your Alchemy quota.

**Do:**
1. Go to https://dashboard.alchemy.com and sign in.
2. In the left menu click **Apps**. Look for an app on **Base Sepolia**.
3. Click it. If you don't use it anymore, click **Delete app** (usually under ⋮ or *Settings*) and confirm.
4. If you still use it, find **API Key → Regenerate** instead.
5. Separately, never send anything to the old wallet `0xF29283Dc81D7Ff69AE6B592d86682Bfb998Ac61A`. Its key is public on GitHub.

**You should see:** the app is gone from the list, or it shows a new key.

**If it goes wrong:** there's no Base Sepolia app? Then nothing to do; the link may have pointed to an app you already deleted.

✅ Tell Claude: **"Alchemy done."**

---

## Step 2: Two secrets for the API (5 min)

**Why:**
- **Instruction key:** a signature key the API uses to sign orders it sends to nodes, so nodes can tell real orders from fake ones. It is *not* a wallet and holds no money.
- **Sign-in secret:** the old one existed while the leaked file was public, so we replace it. Everyone gets signed out of the console once.

**Do** (in your PowerShell window from step 0; paste one line at a time):
```powershell
cd client\api
node -e "process.stdout.write('0x'+require('crypto').randomBytes(32).toString('hex'))" | wr secret put INSTRUCTION_SIGNING_KEY
node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))" | wr secret put JWT_SECRET
cd ..\..
```
Each `node -e …` part makes a random value on your computer and hands it straight to Cloudflare. You never see it, so you can't leak it.

Then open https://api.cloudana.io/v1/nodes/instruction-key in your browser.

**You should see:**
- After each `wr secret put` line: `✨ Success! Uploaded secret …`.
- In the browser: `{"status":"success","address":"0x…"}`. That address is public.

**If it goes wrong:**
- The browser shows `not_configured`: wait 30 seconds and refresh. If it persists, re-run the first `node -e … INSTRUCTION_SIGNING_KEY` line.
- `Need to pass in a value`: you ran `wr secret put` on its own. Run the whole line, including the `node -e … |` part.

✅ Tell Claude: **"instruction key address is 0x…"** (paste the address from the browser).

---

## Step 3: MetaMask, five accounts, test ETH and a Safe (30 min)

**Why:** Cloudana's treasury and admin rights belong to a **Safe**, a shared wallet needing 2 of 3 approvals, so no single lost or stolen key can drain or hijack it. Two more single-purpose wallets do the deploying and the hourly posting.

### 3a. Install MetaMask
1. In Chrome or Edge, go to **https://metamask.io → Download** and add the extension.
2. Click **Create a new wallet** and set a password.
3. MetaMask shows **12 words**. Write them on paper, in order, and store the paper safely. Never type them into a website.
4. Confirm the words when asked.

### 3b. Add the Base Sepolia test network
1. Go to **https://chainlist.org**.
2. Turn on **Include Testnets** (toggle near the search box).
3. Search **Base Sepolia** and check the chain ID is **84532**.
4. Click **Connect Wallet**, approve in MetaMask, then click **Add to MetaMask** and approve.

**You should see:** MetaMask's network selector (top-left) shows **Base Sepolia**. Select it.

### 3c. Create five accounts
1. In MetaMask, click the account name at the top, then **+ Add account or hardware wallet → Add a new account**.
2. Do this until you have five accounts.
3. Rename each one (account menu **⋮ → Account details → ✏️ next to the name**):

| Name | Purpose | Test ETH needed |
|---|---|---|
| Safe Owner 1 | approves Safe transactions | ~0.01 |
| Safe Owner 2 | approves Safe transactions | ~0.005 |
| Safe Owner 3 | backup approver | 0 |
| Deployer | deploys the contracts once | ~0.02 |
| Poster | the keeper's wallet | ~0.05 |

(A hardware wallet such as Ledger as Owner 3 is better, but not needed for testnet.)

### 3d. Get free test ETH
1. Click an account's name to **copy its address** (`0x…`).
2. Go to a faucet and paste the address:
   - **Coinbase:** https://portal.cdp.coinbase.com/products/faucet (sign in with a free Coinbase account, choose **Base Sepolia**, ETH);
   - **Alchemy:** https://www.alchemy.com/faucets/base-sepolia.
3. Repeat for **Deployer**, **Poster**, **Safe Owner 1** and **Safe Owner 2**.

**You should see:** a balance like `0.05 SepoliaETH` within a minute (make sure MetaMask is on Base Sepolia).

**If it goes wrong:**
- "Already claimed today" → use the other faucet, or wait 24 h.
- Balance still 0 → you're looking at the wrong network; switch to Base Sepolia top-left.

### 3e. Create the Safe
1. Go to **https://app.safe.global** and click **Connect wallet → MetaMask**, choosing **Safe Owner 1**.
2. Click **Create account**.
3. **Network:** Base Sepolia. **Name:** `Cloudana Testnet`. Click **Next**.
4. **Signers:** paste the addresses of Safe Owner 1, 2 and 3 (use **+ Add new signer** for more rows).
5. **Threshold:** `2` out of 3. Click **Next**, review, then **Create account**, and approve in MetaMask.
6. When it says the account is ready, click the Safe's name top-left to copy its address. It looks like `basesep:0x…`; keep only the part from `0x`.

**You should see:** your Safe dashboard with 0 balance and three signers listed under **Settings**.

✅ Tell Claude: **"Safe is 0x… and Poster is 0x…"** (two addresses, both public).

---

## Step 4: Deploy the contracts (10 min)

**Why:** this puts the new CLD token and the settlement contract on Base Sepolia, controlled by your Safe. It replaces the old contracts whose key leaked.

**Do:**
1. **Copy the Deployer's private key:** in MetaMask, select **Deployer**, then **⋮ → Account details → Show private key**. Enter your MetaMask password, hold the button, and copy the key (66 characters, starts with `0x`).
2. **Put it in a private file** (in PowerShell from step 0):
   ```powershell
   cd contract
   git check-ignore .env
   ```
   This must print `.env`, meaning Git will never upload the file. If it prints nothing, **stop** and tell Claude.
   ```powershell
   notepad .env
   ```
   Notepad asks *"Do you want to create a new file?"*; click **Yes**. Type `PRIVATE_KEY=`, paste the key right after it with no spaces, then save (Ctrl+S) and close.
3. **Install the contract tools** (first time only; takes a minute or two):
   ```powershell
   npm install
   ```
4. **Deploy:** copy this block into Notepad first, replace both `0xYour…` placeholders with your real Safe and Poster addresses, then paste the whole block into PowerShell:
   ```powershell
   $env:TREASURY_SAFE="0xYourSafeAddress"
   $env:GUARDIAN_SAFE=$env:TREASURY_SAFE
   $env:ADMIN_SAFE=$env:TREASURY_SAFE
   $env:POSTER_ADDRESS="0xYourPosterAddress"
   $env:GENESIS_TIMESTAMP="1791331200"
   npx hardhat run scripts/v2/deploy.ts --network baseSepolia
   ```
   (`GENESIS_TIMESTAMP` = 7 Oct 2026, 00:00 UTC: the hour the new API went live, so everything it records can be settled.)
5. **Remove the key from the file right away:**
   ```powershell
   notepad .env
   ```
   Delete everything, save, close. Then `cd ..` to go back to the project folder.

**You should see:** after about a minute, lines like:
```
CLDTokenV2            0x…
CloudanaSettlementV2  0x…  (genesisEpoch 497592)
token roles: minter=settlement admin=0x…(your Safe) deployer=none
wrote shared/addresses.baseSepolia.json …
```
followed by two `npx hardhat verify …` lines. You can skip those; they only publish source code on Basescan and need an extra free key from etherscan.io.

**If it goes wrong:**
- `insufficient funds` → the Deployer needs more test ETH (step 3d).
- `invalid private key` / `HH8` → the `.env` line is wrong. It must be exactly `PRIVATE_KEY=0x…`, with no quotes or spaces.
- `TREASURY_SAFE must be set to an address` → you're in a new window or a placeholder is still there; paste the `$env:` lines again with real addresses.
- `no deployer: set PRIVATE_KEY` → `.env` is empty or saved somewhere else; it must be `contract\.env`.
- Anything else: copy the red error text (never the key) to Claude.

✅ Tell Claude: **"contracts deployed"**. Claude reads the new addresses from `shared/addresses.baseSepolia.json` and wires them into the API and keeper. Wait for Claude's "ready for step 5".

---

## Step 5: Turn on the keeper (10 min, after Claude says ready)

**Why:** every hour the API totals who earned what. The keeper posts that batch to the settlement contract, then pays everyone. It signs with the Poster wallet, so it needs the Poster's key. It also needs a shared password with the API (the *internal key*), which this step sets on both at the same time.

**Do** (PowerShell from step 0; one line at a time):
```powershell
git pull
$k = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
cd client\api
$k | wr secret put INTERNAL_API_KEY
cd ..\..\keeper
npm install
$k | wr secret put INTERNAL_API_KEY
wr secret put POSTER_PRIVATE_KEY
```
The last line asks **"Enter a secret value:"**. In MetaMask, select **Poster → ⋮ → Account details → Show private key**, copy it, paste it at the prompt (it stays invisible; that's normal) and press **Enter**.

Then deploy the keeper:
```powershell
wr deploy
cd ..
```

**You should see:**
- `✨ Success! Uploaded secret` three times, and `Deployed cloudana-keeper` with a `schedule: */5 * * * *` line.
- https://cloudana-keeper.amraldabbas19.workers.dev/health shows `"settlement":"0x…"` (your new contract) and a `posterBalanceEth` above 0.

**If it goes wrong:**
- `/health` shows an error about the API → the two `INTERNAL_API_KEY` values differ (e.g. you opened a new window between lines, so `$k` was empty). Re-run the whole block from `$k = …` in one window.
- `posterBalanceEth: "0"` → fund the Poster (step 3d).

✅ Tell Claude: **"keeper deployed"**.

---

## Step 6: Fund the escrow (10 min)

**Why:** the token contract minted **1,000,000 test CLD** to your Safe. Free test credits in the console are tracked off-chain, so the settlement contract needs real (test) CLD parked in it to burn when it settles fees. Without it the keeper says *"fees exceed free escrow"* and nobody gets paid.

You'll create **two actions in one batch**:
- `approve` lets the settlement contract take CLD from the Safe;
- `deposit` moves 10,000 CLD into it.

Claude gives you both addresses (token and settlement) after step 4.

**Do:**
1. Go to https://app.safe.global, select the **Cloudana Testnet** Safe, and check the balance shows **1,000,000 CLD** (under *Assets*; you may need to enable "show all tokens").
2. Left menu **Apps** → search **Transaction Builder** → open it.
3. **First action (approve):**
   - **Enter Address:** the **CLD token address**.
   - If a box asks for an **ABI**, paste:
     ```json
     [{"type":"function","name":"approve","stateMutability":"nonpayable","inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],"outputs":[{"type":"bool"}]}]
     ```
   - **Contract Method:** `approve`.
   - **spender:** the **settlement address**.
   - **amount:** `10000000000000000000000` (that's 10,000 followed by 18 zeros, because CLD has 18 decimals).
   - Click **Add transaction**.
4. **Second action (deposit):**
   - **Enter Address:** the **settlement address**.
   - ABI (if asked):
     ```json
     [{"type":"function","name":"deposit","stateMutability":"nonpayable","inputs":[{"name":"amount","type":"uint256"}],"outputs":[]}]
     ```
   - **Method:** `deposit`, **amount:** `10000000000000000000000`.
   - Click **Add transaction**.
5. Click **Create Batch → Send Batch → Sign** (MetaMask on Safe Owner 1).
6. In MetaMask switch to **Safe Owner 2**, reload the Safe page, open **Transactions → Queue**, click the batch, then **Confirm**, and finally **Execute**.

**You should see:** the transaction moves to **History** as *Success*, and the Safe's CLD balance drops to 990,000.

**If it goes wrong:**
- *"Transaction will fail"* warning → check the amount has exactly 22 digits and the addresses aren't swapped (token first, settlement second).
- Execute is greyed out → the second owner hasn't confirmed yet.

✅ Tell Claude: **"escrow funded"**. Claude then watches the first hourly batch go through end to end.

---

## Step 7: Email aliases privacy@ and abuse@ (5 min)

**Why:** the Terms and Privacy pages tell people to write to `privacy@cloudana.io` and `abuse@cloudana.io`. Your cloudana.io email runs on **Microsoft 365**, so add them there as free aliases. (Claude deliberately did not switch on Cloudflare's email feature; it would have broken your inbox.)

**Do:**
1. Go to **https://admin.microsoft.com** and sign in with your Microsoft 365 admin account.
2. Left menu **Users → Active users**, then click your own name.
3. On the **Account** tab, find **Aliases → Manage username and email**.
4. Under **Aliases**, type `privacy`, make sure the domain dropdown says `cloudana.io`, click **Add**, then **Save changes**.
5. Repeat for `abuse`.

**You should see:** both aliases listed. Within ~15 minutes, an email from your Gmail to `abuse@cloudana.io` arrives in your Outlook inbox.

**If it goes wrong:** no admin rights? Then whoever set up Microsoft 365 for cloudana.io needs to do it.

✅ Tell Claude: **"aliases done"**.

---

## Step 8: Hosting addresses `*.sites.cloudana.io` (10 min, ~$10/month; can wait)

**Why:** when someone hosts a website on Cloudana, it gets an address like `https://<id>.sites.cloudana.io`. The gateway that serves those is already deployed; it needs one DNS record, plus a certificate so browsers show the padlock. The free certificate only covers one level (`*.cloudana.io`), so `*.sites.cloudana.io` needs Cloudflare's paid **Advanced Certificate Manager** (about $10/month). Only needed once the first hosting node is online.

**Do:**
1. Go to **https://dash.cloudflare.com**, then click **cloudana.io**.
2. **DNS → Records → + Add record**:
   - **Type:** `AAAA`
   - **Name:** `*.sites`
   - **IPv6 address:** `100::`
   - **Proxy status:** orange cloud **ON (Proxied)**
   - Click **Save**. (`100::` is a placeholder; Cloudflare intercepts every request before it goes anywhere.)
3. **SSL/TLS → Edge Certificates → Order an advanced certificate** (subscribe to Advanced Certificate Manager if asked):
   - **Hostnames:** `sites.cloudana.io` and `*.sites.cloudana.io`.
   - Leave the other defaults and click **Save / Order**.
4. Wait until the certificate status says **Active** (minutes to an hour).

**You should see:** https://test.sites.cloudana.io shows a small dark *"This site is not here"* page with a valid padlock.

✅ Tell Claude: **"sites done"**. Claude tests a real site end to end.

---

## Step 9: Make the node image public (2 min, after Claude bakes in your step-2 address)

**Why:** node operators download the Cloudana node software from GitHub's package registry. New packages start private, so it must be public before anyone, including your workstation, can download it without logging in.

**Do:**
1. Go to **https://github.com/AmrDab?tab=packages**.
2. Click **cloudana-node-agent**, then **Package settings** (right side).
3. Scroll to **Danger Zone → Change visibility**, choose **Public**, type `cloudana-node-agent` to confirm, and click **I understand…**.

**You should see:** the package page shows a **Public** badge.

✅ Tell Claude: **"image public"**.

---

## Step 10: Your workstation as node #1 (when it's ready)

Tell Claude **"workstation ready"**, with its operating system (Windows/Linux) and whether it has an NVIDIA GPU. You'll get:
1. one install command (Docker or Node), pre-filled with the right settings;
2. router instructions to forward ports **42000–42100** to the workstation, so the sites it hosts can be reached;
3. a link the agent prints. Open it, connect MetaMask (any account; your earnings go there) and sign to bind the node to you.

Home machines run **compute jobs and static websites only**. Container and GPU rentals stay off until a properly hardened datacenter node exists. That's a security decision, not a bug.

---

## Later: before CLD has any real value
Not needed for testnet, but don't skip them before mainnet:
- a lawyer reviews the token and payment setup;
- a professional audit of the two v2 contracts;
- a guardian signer who isn't you, and a 48-hour delay on admin changes;
- re-checking the mainnet numbers in `docs/DECISIONS_CONSENSUS.md`.
