# Local chain + settlement (LOCAL ONLY)

Run from `contract/` after `npm install --legacy-peer-deps`. Three terminals:

```sh
# 1. local chain (chainId 1337, http://127.0.0.1:8545)
npx hardhat node

# 2. deploy CLDToken + CloudanaSettlement; Settlement becomes the only minter.
#    Writes ../shared/addresses.local.json and ../shared/abi/CloudanaSettlement.json
EPOCH_SECONDS=120 VETO_DELAY_SECONDS=30 npx hardhat run scripts/local/deploy.ts --network localhost

# 3. keeper: every 10 s close epochs on the API -> post root -> finalize after the veto -> claimFor -> report
INTERNAL_API_KEY=<same as client/api/.dev.vars> npx hardhat run scripts/local/keeper.ts --network localhost
```

- `EPOCH_SECONDS` must equal the API's `EPOCH_SECONDS` (the contract derives each epoch's start as `epoch × epochSeconds`).
- Keeper env: `API` (default `http://127.0.0.1:8790`), `KEEPER_ONCE=1` for a single pass.
- Accounts: `[0]` deployer = admin/poster/guardian, `[1]` treasury (800k CLD), `[2]` team (200k CLD).
- DEV BACKING: user credits are off-chain, so when escrow is short of an epoch's fees the keeper has the
  treasury deposit the shortfall (logged). Real deployments escrow user deposits instead.
- Merkle trees live in keeper memory — keep it running from post to settle. Restarting `hardhat node` wipes the chain: redeploy.
