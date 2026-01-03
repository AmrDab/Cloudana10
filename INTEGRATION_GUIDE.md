# Cloudana MVP Integration Guide

This guide explains how to integrate the smart contracts with the frontend and backend for a complete working MVP.

## Overview

The MVP consists of:
- **Smart Contracts**: CLDToken, ProviderRegistry, JobEscrow (in `/contracts`)
- **Backend**: Express API with EIP-712 signature generation (in `/server`)
- **Frontend**: React app with wagmi/viem integration (in `/client`)

## Prerequisites

1. Deploy contracts to Base Sepolia testnet
2. Set up environment variables
3. Run database migrations
4. Configure contract addresses

## Step 1: Deploy Contracts

```bash
cd contracts
npm install
npm run compile
npm run deploy:base-sepolia
```

This will:
- Deploy all three contracts
- Export ABIs to `../cloudana-mvp-replit/shared/abi/`
- Write addresses to `../cloudana-mvp-replit/shared/addresses.baseSepolia.json`

After deployment, update `shared/contracts.ts` with the deployed addresses.

## Step 2: Environment Variables

### Backend (.env)

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
VALIDATOR_PRIVATE_KEY=0x...  # Private key for signing usage reports (must have VALIDATOR_ROLE)
PORT=5000
```

### Frontend (.env or environment)

```env
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

## Step 3: Database Setup

The schema includes an `onChainJobId` field in the `jobs` table to track the on-chain job ID.

```bash
cd cloudana-mvp-replit
npm run db:push  # Push schema changes
```

## Step 4: Contract Integration

### Contract Hooks

Contract interaction hooks are available in `client/src/lib/contracts.ts`:

- **CLDToken**: `useCLDTokenBalance`, `useApproveCLDToken`
- **ProviderRegistry**: `useProviderInfo`, `useRegisterProvider`, `useSetProviderActive`
- **JobEscrow**: `useCreateJob`, `useCloseJob`, `useSubmitUsageReport`, `useWithdrawProvider`, `useWithdrawUserRefund`

### Workflow

#### 1. Register Provider

```typescript
import { useRegisterProvider } from "@/lib/contracts";

const { register, isPending, isSuccess } = useRegisterProvider();

// In your component
const handleRegister = () => {
  register("0x...metadataHash", "0"); // Optional burn amount
};
```

#### 2. Create Job (Frontend)

Jobs must be created on-chain FIRST, then synced to the database:

```typescript
import { useCreateJob, useApproveCLDToken } from "@/lib/contracts";
import { JOB_ESCROW_ADDRESS } from "@/lib/contracts";

// 1. Approve tokens
const { approve: approveToken } = useApproveCLDToken();
await approveToken(JOB_ESCROW_ADDRESS, "100"); // Approve 100 CLD

// 2. Create job on-chain
const { create: createJob, data: txHash, isSuccess } = useCreateJob();
await createJob(providerAddress, "100"); // 100 CLD deposit

// 3. After transaction confirms, get the jobId from the transaction receipt
// 4. Create database record with onChainJobId
const response = await fetch("/api/jobs", {
  method: "POST",
  body: JSON.stringify({
    creator: userAddress,
    providerId: providerDbId,
    deposit: "100",
    onChainJobId: jobId.toString(), // From contract
  }),
});
```

#### 3. Submit Usage Report

```typescript
// 1. Request signature from backend
const response = await fetch("/api/usage-reports/request-signature", {
  method: "POST",
  body: JSON.stringify({
    jobId: dbJobId,
    grossCost: "10",
    providerEarn: "9",
    userRefund: "1",
  }),
});
const { signature, jobNonce } = await response.json();

// 2. Submit to contract
const { submit } = useSubmitUsageReport();
await submit({
  jobId: BigInt(onChainJobId),
  user: userAddress,
  provider: providerAddress,
  grossCost: "10",
  providerEarn: "9",
  nonce: BigInt(jobNonce),
  deadline: BigInt(0),
}, signature);
```

#### 4. Withdraw Credits

```typescript
// Provider withdraws earnings
const { withdraw: withdrawProvider } = useWithdrawProvider();
await withdrawProvider();

// User withdraws refunds
const { withdraw: withdrawUserRefund } = useWithdrawUserRefund();
await withdrawUserRefund();
```

## Step 5: Backend EIP-712 Signing

The backend automatically signs usage reports using the `VALIDATOR_PRIVATE_KEY`. The validator address must have the `VALIDATOR_ROLE` on the JobEscrow contract.

After deploying contracts, grant the validator role:

```typescript
// In deploy script or manually
await jobEscrow.grantRole(VALIDATOR_ROLE, validatorAddress);
```

## Step 6: Update Frontend Pages

The frontend pages need to be updated to use the contract hooks instead of mock data:

1. **Provider Dashboard** (`client/src/pages/provider-dashboard.tsx`):
   - Use `useRegisterProvider` for registration
   - Use `useProviderInfo` to check provider status
   - Use `useSetProviderActive` to toggle status

2. **User Dashboard** (`client/src/pages/user-dashboard.tsx`):
   - Use `useCLDTokenBalance` to show balance
   - Use `useApproveCLDToken` before creating jobs
   - Use `useCreateJob` to create jobs on-chain
   - Sync jobs to database after on-chain creation

3. **Job Detail** (`client/src/pages/job-detail.tsx`):
   - Use `useJobInfo` to read on-chain job data
   - Use `useSubmitUsageReport` to submit reports
   - Use `useCloseJob` to close jobs

## Notes for Future Scalability

- The DePIN agent logic (usage verification) is not implemented yet
- Current MVP uses simplified usage reporting
- Database and on-chain state should be kept in sync via event indexing (future work)
- Consider adding an event indexer to automatically sync contract events to database

## Testing the MVP

1. Deploy contracts to testnet
2. Fund test accounts with testnet ETH and CLD tokens
3. Register a provider
4. Create a job with CLD deposit
5. Submit usage reports
6. Withdraw credits

## Troubleshooting

- **Contract addresses not found**: Update `shared/contracts.ts` after deployment
- **Signature verification fails**: Ensure validator has VALIDATOR_ROLE
- **Job creation fails**: Check token approval and provider registration
- **Database sync issues**: Ensure `onChainJobId` is set when creating database jobs

