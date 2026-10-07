# Owner runbook: testnet go-live (beginner edition)

Claude has already done everything that doesn't need your keys, accounts or signature:

- deleted the leaked old key from the API;
- deployed the new API, both websites and the hosting gateway Worker;
- published the node-agent image.

These steps are yours, in order. Each one ends with what to tell Claude.

> **Golden rule:** a *private key* (a long `0x…` secret, 66 characters) is the password to a wallet.
> Never paste it into chat, a GitHub issue, a screenshot, or any file except the two places this guide names.
> An *address* (`0x…`, 42 characters) is public and safe to share.

---

## Before you start: open PowerShell the same way every time

1. Press the **Windows key**, type `PowerShell`, and open **Windows PowerShell**.
2. Go to the project folder by pasting this and pressing Enter:
   ```powershell
   cd C:\Users\amr_d\Cloudana10-site
   git pull
   ```
   (This folder follows the latest `main`; `git pull` brings in whatever Claude last shipped.)
3. Paste this once per PowerShell window. It creates a short command `wr` for Cloudflare's tool, *wrangler*:
   ```powershell
   function wr { node "$env:LOCALAPPDATA\npm-cache\_npx\32026684e21afda6\node_modules\wrangler\bin\wrangler.js" @args }
   ```
   Test it with `wr whoami`. It should print your email, `amraldabbas19@gmail.com`.

If you close the window, repeat steps 2 and 3 in the new one.

---

## Step 1: Rotate the leaked Alchemy key (5 min)
The old `.env` that leaked also contained an Alchemy URL with a key in it.

1. Go to https://dashboard.alchemy.com and sign in.
2. Open **Apps**, then find the Base Sepolia app (the one whose URL ended up in the repo).
3. Click it, then **Delete app**. Or, if you still use it, regenerate its **API key** in the app settings.

Also, from now on never use the wallet `0xF29283Dc81D7Ff69AE6B592d86682Bfb998Ac61A`. Its key is public.

✅ Tell Claude: *"Alchemy done."*

---

## Step 2: Set the node instruction key and rotate the sign-in secret (5 min)
In your PowerShell window (folder `Cloudana10-site`, with `wr` defined), paste these lines one at a time:

```powershell
cd client\api
node -e "process.stdout.write('0x'+require('crypto').randomBytes(32).toString('hex'))" | wr secret put INSTRUCTION_SIGNING_KEY
node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))" | wr secret put JWT_SECRET
cd ..\..
```
Each line makes a random secret and sends it straight to Cloudflare; you never see it. Each should print `✨ Success!`.

The second line signs everyone out of the console once; that's expected.

Now open this in your browser: https://api.cloudana.io/v1/nodes/instruction-key.
You'll see something like `{"status":"success","address":"0xABC…"}`.

✅ Tell Claude: *"instruction key address is 0x…"* (it's public). Claude builds it into the node agent.

---

## Step 3: Make wallets and a Safe (25 min)
You need: **3 owner wallets** (for the Safe), **1 deployer** wallet (used once) and **1 poster** wallet (used by the keeper robot).

### 3a. Install MetaMask and add Base Sepolia
1. Install the **MetaMask** browser extension from https://metamask.io, create a wallet, and **write the recovery phrase on paper**.
2. Open https://chainlist.org, tick **"Include Testnets"**, search **Base Sepolia** (chain ID 84532) and click **Add to MetaMask**.

### 3b. Create five accounts
In MetaMask, click the account name at the top, then **+ Add account** (or "Create account"). Make five and rename them so you don't mix them up:

| Name | Used for |
|---|---|
| Safe Owner 1 | signs Safe transactions |
| Safe Owner 2 | signs Safe transactions |
| Safe Owner 3 | backup signer (a hardware wallet is even better) |
| Deployer | deploys the contracts once, then is never used again |
| Poster | the keeper uses it to post settlement batches |

### 3c. Get free test ETH
1. Copy the **Deployer** address (click the account name to copy it).
2. Paste it into a Base Sepolia faucet, for example:
   - Coinbase: https://portal.cdp.coinbase.com/products/faucet (choose Base Sepolia);
   - Alchemy: https://www.alchemy.com/faucets/base-sepolia.
3. Do the same for **Poster** and **Safe Owner 1**. Target: ~0.02 ETH on Deployer, ~0.05 on Poster, a little on Owner 1.

Test ETH is free and has no value. Faucets limit how often you can claim, so you may need two faucets.

### 3d. Create the Safe
1. Go to https://app.safe.global and click **Connect wallet** (MetaMask, as **Safe Owner 1**).
2. Click **Create account**.
3. Network: **Base Sepolia**. Name: `Cloudana Testnet`.
4. Owners: add the addresses of **Safe Owner 1, 2 and 3**. Threshold: **2 out of 3**.
5. Review, then **Create**, and confirm in MetaMask (it costs a tiny amount of test ETH).
6. When it's done, copy the **Safe address** (shown top-left, starting with `basesep:0x…`; copy only the `0x…` part).

✅ Tell Claude: *"Safe is 0x… and poster is 0x…"* (both are addresses, both public).

---

## Step 4: Deploy the contracts (10 min)
1. In MetaMask, select the **Deployer** account, then **⋮ → Account details → Show private key**. Enter your password and copy the key.
2. In PowerShell (folder `Cloudana10-site`):
   ```powershell
   cd contract
   notepad .env
   ```
   Notepad asks to create the file; click **Yes**. Type one line, `PRIVATE_KEY=` followed by the key you copied, e.g. `PRIVATE_KEY=0xabc123…`. Save and close Notepad.
3. Check the file will never be uploaded to GitHub:
   ```powershell
   git check-ignore .env
   ```
   It must print `.env`. If it prints nothing, **stop** and tell Claude.
4. Paste this, replacing the two `0x…` placeholders with your Safe address and Poster address:
   ```powershell
   $env:TREASURY_SAFE="0xYourSafeAddress"; $env:GUARDIAN_SAFE=$env:TREASURY_SAFE; $env:ADMIN_SAFE=$env:TREASURY_SAFE
   $env:POSTER_ADDRESS="0xYourPosterAddress"
   $env:GENESIS_TIMESTAMP="1791331200"
   npx hardhat run scripts/v2/deploy.ts --network baseSepolia
   ```
   It prints the new token and settlement addresses and finishes with a line about roles. If it shows a red error, copy the error (never the key) to Claude.
5. **Remove the key from the file:**
   ```powershell
   notepad .env
   ```
   Delete the whole line, save, and close.
6. (Optional) It also printed two `npx hardhat verify …` lines. Those publish the source on Basescan and need a free API key from etherscan.io. Skip them if you like; nothing depends on them.

✅ Tell Claude: *"contracts deployed"*. Claude reads the new addresses from `shared/addresses.baseSepolia.json` and wires them into the API and the keeper.

---

## Step 5: Turn on the keeper robot (10 min, after Claude says it's wired)
The keeper and the API share one internal password, so this step sets it on both at once.

```powershell
cd C:\Users\amr_d\Cloudana10-site
git pull
$k = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
cd client\api
$k | wr secret put INTERNAL_API_KEY
cd ..\..\keeper
npm install
$k | wr secret put INTERNAL_API_KEY
wr secret put POSTER_PRIVATE_KEY
```
The last command asks *"Enter a secret value"*. In MetaMask, copy the **Poster** account's private key (as in step 4.1), paste it at the prompt and press Enter. The paste is hidden; that's normal.

Then:
```powershell
wr deploy
```
Open the keeper's health page: https://cloudana-keeper.amraldabbas19.workers.dev/health. It should show your settlement address and the poster's ETH balance.

✅ Tell Claude: *"keeper deployed"*.

---

## Step 6: Put CLD into the settlement escrow (10 min)
The new contract minted 1,000,000 test CLD to your Safe. The settlement needs some of it in escrow before it can settle batches.

1. Go to https://app.safe.global, open your **Cloudana Testnet** Safe, and click **Apps → Transaction Builder**.
2. **First call:**
   - Address: the **CLD token** address (Claude gives it to you after step 4).
   - If it asks for an ABI, paste this:
     ```json
     [{"type":"function","name":"approve","stateMutability":"nonpayable","inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],"outputs":[{"type":"bool"}]}]
     ```
   - Method `approve`, spender = the **settlement** address, amount = `10000000000000000000000` (10,000 CLD, written with 18 zeros of decimals).
   - Click **Add transaction**.
3. **Second call:**
   - Address: the **settlement** address.
   - ABI:
     ```json
     [{"type":"function","name":"deposit","stateMutability":"nonpayable","inputs":[{"name":"amount","type":"uint256"}],"outputs":[]}]
     ```
   - Method `deposit`, amount = `10000000000000000000000`.
   - Click **Add transaction**.
4. Click **Create batch**, then **Send batch**, and sign with Owner 1.
5. Switch MetaMask to **Safe Owner 2**, open the pending transaction in the Safe app, click **Confirm**, then **Execute**.

✅ Tell Claude: *"escrow funded"*.

---

## Step 7: Create privacy@ and abuse@ (5 min)
cloudana.io email runs on **Microsoft 365 (Outlook)**. Claude didn't touch it, because Cloudflare Email Routing would have broken your inbox.

1. Go to https://admin.microsoft.com and sign in as the admin.
2. Open **Users → Active users** and click your own user.
3. Under **Aliases**, click **Manage username and email**.
4. Add alias `privacy` with domain `cloudana.io`, and save. Do the same for `abuse`.

Mail to those addresses now lands in your inbox. Test by emailing `abuse@cloudana.io` from your Gmail.

✅ Tell Claude: *"aliases done"*.

---

## Step 8: Hosting addresses `*.sites.cloudana.io` (10 min, ~$10/month; can wait)
Only needed once someone hosts a site. The gateway Worker is already deployed; it needs a DNS record and a certificate.

1. Go to https://dash.cloudflare.com, then **cloudana.io → DNS → Records → Add record**:
   - Type **AAAA**, Name `*.sites`, IPv6 address `100::`.
   - Proxy status **Proxied** (orange cloud).
   - Click **Save**.
2. **SSL/TLS → Edge Certificates → Order Advanced Certificate**:
   - Hostnames: `sites.cloudana.io` and `*.sites.cloudana.io`.
   - Keep the defaults and order it. It needs the Advanced Certificate Manager add-on (~$10/month).
   - The certificate usually becomes **Active** within a few minutes to an hour.

✅ Tell Claude: *"sites DNS and certificate done"*. Claude tests it end to end.

---

## Step 9: Make the node image public (2 min, after Claude bakes in the step-2 address)
1. Go to https://github.com, click your profile picture, then **Your profile → Packages**.
2. Click **cloudana-node-agent → Package settings** (right side).
3. At the bottom, under **Danger Zone**, click **Change visibility → Public**, type the name to confirm, and click **I understand**.

✅ Tell Claude: *"image is public"*.

---

## Step 10: Your workstation as node #1 (when it's ready)
Tell Claude when the workstation is running. You'll get:

1. the one command that installs and starts the agent;
2. how to forward ports **42000–42100** on your router to the workstation (so hosted sites are reachable);
3. a link the agent prints. Open it and sign with MetaMask to bind the node to your wallet.

Home computers run compute jobs and static sites only; containers and GPU rentals stay off until a hardened datacenter node exists.

---

## Before CLD has any real value (not now)
- A lawyer reviews the token and payment setup.
- A professional audit of the v2 contracts.
- Add a guardian signer who isn't you, and a 48-hour delay on admin changes.
- Re-check the mainnet numbers in `docs/DECISIONS_CONSENSUS.md`.
