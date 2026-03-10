import { useEffect, useState, useCallback } from 'react';
import { usePublicClient, useAccount } from 'wagmi';
import { CHAIN_ID, WORKLOAD_REGISTRY_ADDRESS } from '@/lib/contracts';
import { WorkloadRegistryAbi } from '@shared/contracts';
import { devLoggers } from '@/lib/logger';

const L = devLoggers.userJobs;

export interface UserJob {
  jobId: bigint; // workloadId
  user: string; // owner address
  /** Placement provider wallet address (from workload.placementProvider); not deviceId. */
  pubKeyHash: string;
  deposited: bigint; // Not available in WorkloadRegistry - set to 0
  spent: bigint; // Not available in WorkloadRegistry - set to 0
  remaining: bigint; // Not available in WorkloadRegistry - set to 0
  nonce: bigint; // Not available in WorkloadRegistry - set to 0
  /** WorkloadStatus (contract): 0 = Inactive, 1 = Active */
  status: number;
  createdAt: number; // registeredAt timestamp
  closedAt: number; // updatedAt when Inactive
  transactionHash: string;
  manifestCID: string; // metadataUri (IPFS/URL) from chain
}

interface UseUserJobsOptions {
  enabled?: boolean;
  onNewJob?: (job: UserJob) => void;
}

interface UseUserJobsReturn {
  jobs: UserJob[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Real-time hook for listening to JobCreated events for a specific user
 * 
 * DePIN Architecture: Direct blockchain connection - no backend needed
 * 
 * @example
 * ```tsx
 * const { jobs, loading } = useUserJobs({
 *   onNewJob: (job) => {
 *     toast.success(`New job created: ${job.jobId}`);
 *   }
 * });
 * ```
 */
export function useUserJobs(
  options: UseUserJobsOptions = {}
): UseUserJobsReturn {
  const {
    enabled = true,
    onNewJob
  } = options;

  const { address } = useAccount();
  const [jobs, setJobs] = useState<UserJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seenTxHashes] = useState(new Set<string>());

  const publicClient = usePublicClient({ chainId: CHAIN_ID });

  // Format event data for display (kept for compatibility but not used for WorkloadRegistry)
  const formatJobEvent = useCallback((data: {
    jobId: bigint;
    user: string;
    pubKeyHash: string;
    budgetAmount: bigint;
    blockNumber: bigint;
    transactionHash: string;
    timestamp?: bigint;
    manifestCID?: string;
  }): UserJob => {
    return {
      jobId: data.jobId,
      user: data.user,
      pubKeyHash: data.pubKeyHash,
      deposited: data.budgetAmount,
      spent: BigInt(0), // Will be updated when we fetch job details
      remaining: data.budgetAmount,
      nonce: BigInt(0),
      status: 0, // Pending
      createdAt: data.timestamp ? Number(data.timestamp) : Date.now() / 1000,
      closedAt: 0,
      transactionHash: data.transactionHash,
      manifestCID: data.manifestCID || '',
    };
  }, []);

  // Add job with deduplication
  const addJob = useCallback((job: UserJob) => {
    if (seenTxHashes.has(job.transactionHash)) {
      return; // Already processed
    }
    
    seenTxHashes.add(job.transactionHash);
    setJobs(prev => [job, ...prev]);
    
    if (onNewJob) {
      onNewJob(job);
    }
  }, [onNewJob, seenTxHashes]);

  // Load historical events and fetch workload details
  useEffect(() => {
    if (!enabled || !publicClient || !address) {
      setLoading(false);
      return;
    }

    const loadUserJobs = async () => {
      try {
        setLoading(true);
        setError(null);

        L.log('Fetching user workloads from blockchain...');
        L.log('User address:', address);
        L.log('Contract address:', WORKLOAD_REGISTRY_ADDRESS);
        
        // Step 1: Get workload IDs directly from contract (more efficient)
        let workloadIds: bigint[] = [];
        try {
          const userWorkloads = await publicClient.readContract({
            address: WORKLOAD_REGISTRY_ADDRESS,
            abi: WorkloadRegistryAbi,
            functionName: 'getUserWorkloads',
            args: [address],
          }) as bigint[];
          workloadIds = userWorkloads || [];
          L.success(`getUserWorkloads returned ${workloadIds.length} workload IDs:`, workloadIds.map(id => id.toString()));
        } catch (err) {
          L.error('getUserWorkloads failed:', err);
          throw new Error('Failed to fetch workload IDs from contract');
        }
        
        if (workloadIds.length === 0) {
          L.log('No workloads found for user');
          setJobs([]);
          setLoading(false);
          return;
        }
        
        // Step 2: Optionally fetch events to get transaction hashes (non-blocking, don't fail if it times out)
        const workloadTxMap = new Map<bigint, string>();
        try {
          // Determine block range: if we have few workloads, try to fetch all events from earliest workload
          // Otherwise, fetch recent events (last 10000 blocks) to avoid timeout
          const currentBlock = await publicClient.getBlockNumber();
          let fromBlock: bigint;
          
          // If we only have a few workloads (≤ 5), try to fetch all events to ensure we get the first one
          if (workloadIds.length <= 5) {
            // For small number of workloads, fetch more history (last 50k blocks or from 0)
            fromBlock = currentBlock > BigInt(50000) ? currentBlock - BigInt(50000) : BigInt(0);
            L.log(`Fetching events from block ${fromBlock} (expanded range for ${workloadIds.length} workloads)`);
          } else {
            // For many workloads, use smaller range to avoid timeout
            fromBlock = currentBlock > BigInt(10000) ? currentBlock - BigInt(10000) : BigInt(0);
            L.log(`Fetching events from block ${fromBlock} (standard range for ${workloadIds.length} workloads)`);
          }
          
          const logs = await Promise.race([
            publicClient.getContractEvents({
              address: WORKLOAD_REGISTRY_ADDRESS,
              abi: WorkloadRegistryAbi,
              eventName: 'WorkloadRegistered',
              args: {
                owner: address,
              },
              fromBlock: fromBlock,
              toBlock: 'latest',
            }),
            // Timeout after 8 seconds (increased from 5 to allow for larger block ranges)
            new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 8000))
          ]);
          
          logs.forEach((log: any) => {
            if (log.args?.workloadId !== undefined && log.args?.workloadId !== null) {
              workloadTxMap.set(log.args.workloadId, log.transactionHash);
            }
          });
          L.success(`Found ${logs.length} events with transaction hashes (searched ${workloadIds.length} workload IDs)`);
        } catch (err) {
          L.warn('Event fetching failed or timed out (non-critical):', err);
          // Continue without transaction hashes - workloads will still be displayed
        }
        
        // Step 3: Fetch workload details for each ID
        L.log(`Fetching details for ${workloadIds.length} workloads...`);

        // Fetch full workload details for each workload ID
        const jobsWithDetails = await Promise.all(
          workloadIds.map(async (workloadId: bigint) => {
            try {
              L.debug(`Fetching workload ${workloadId}...`);
              
              // Get workload details from contract
              // Viem returns tuples as objects with named properties when ABI has component names
              const workloadData = await publicClient.readContract({
                address: WORKLOAD_REGISTRY_ADDRESS,
                abi: WorkloadRegistryAbi,
                functionName: 'getWorkload',
                args: [workloadId],
              }) as {
                id: bigint;
                owner: `0x${string}`;
                metadataUri: string;
                status: number;
                registeredAt: bigint;
                updatedAt: bigint;
                placementProvider: string;
                placementInstanceId: bigint;
              };

              L.debug(`Workload ${workloadId} data:`, {
                id: workloadData.id?.toString(),
                owner: workloadData.owner,
                status: workloadData.status,
                registeredAt: workloadData.registeredAt?.toString(),
              });

              const status = Number(workloadData.status ?? 0); // 0=Inactive, 1=Active
              const createdAt = Number(workloadData.registeredAt ?? 0);
              const updatedAt = Number(workloadData.updatedAt ?? 0);
              const manifestCID = typeof workloadData.metadataUri === 'string' ? workloadData.metadataUri : '';
              const pubKeyHash = workloadData.placementProvider || '';

              return {
                jobId: workloadId,
                user: workloadData.owner || address || '',
                pubKeyHash,
                deposited: BigInt(0),
                spent: BigInt(0),
                remaining: BigInt(0),
                nonce: BigInt(0),
                status,
                createdAt,
                closedAt: status === 0 ? updatedAt : 0, // Inactive = closed
                transactionHash: workloadTxMap.get(workloadId) || '',
                manifestCID,
              } as UserJob;
            } catch (err) {
              L.error(`Failed to fetch details for workload ${workloadId}:`, err);
              return null;
            }
          })
        );

        const validJobs = jobsWithDetails
          .filter((job): job is UserJob => job !== null)
          .sort((a: UserJob, b: UserJob) => Number(b.createdAt) - Number(a.createdAt)); // Most recent first

        L.success(`Successfully loaded ${validJobs.length} workloads`);
        validJobs.forEach((job: UserJob) => {
          if (job.transactionHash) {
            seenTxHashes.add(job.transactionHash);
          }
        });
        setJobs(validJobs);
      } catch (err: any) {
        L.error('Error fetching historical:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadUserJobs();
  }, [enabled, publicClient, address, seenTxHashes]);

  // Manual refetch
  const refetch = useCallback(async () => {
    if (!publicClient || !address) return;
    
    try {
      setLoading(true);
      
      // Step 1: Get workload IDs directly from contract
      const userWorkloads = await publicClient.readContract({
        address: WORKLOAD_REGISTRY_ADDRESS,
        abi: WorkloadRegistryAbi,
        functionName: 'getUserWorkloads',
        args: [address],
      }) as bigint[];
      
      const workloadIds = userWorkloads || [];
      
      if (workloadIds.length === 0) {
        setJobs([]);
        setLoading(false);
        return;
      }
      
      // Step 2: Optionally fetch recent events for transaction hashes (non-blocking)
      const workloadTxMap = new Map<bigint, string>();
      try {
        const currentBlock = await publicClient.getBlockNumber();
        let fromBlock: bigint;
        
        // If we only have a few workloads (≤ 5), try to fetch all events to ensure we get the first one
        if (workloadIds.length <= 5) {
          fromBlock = currentBlock > BigInt(50000) ? currentBlock - BigInt(50000) : BigInt(0);
        } else {
          fromBlock = currentBlock > BigInt(10000) ? currentBlock - BigInt(10000) : BigInt(0);
        }
        
        const logs = await Promise.race([
          publicClient.getContractEvents({
            address: WORKLOAD_REGISTRY_ADDRESS,
            abi: WorkloadRegistryAbi,
            eventName: 'WorkloadRegistered',
            args: {
              owner: address,
            },
            fromBlock: fromBlock,
            toBlock: 'latest',
          }),
          new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 8000))
        ]);
        
        logs.forEach((log: any) => {
          if (log.args?.workloadId !== undefined && log.args?.workloadId !== null) {
            workloadTxMap.set(log.args.workloadId, log.transactionHash);
          }
        });
      } catch (err) {
        L.warn('Event fetching failed (non-critical):', err);
      }
      
      // Step 3: Fetch workload details for each ID
      const jobsWithDetails = await Promise.all(
        workloadIds.map(async (workloadId: bigint) => {
          try {
            const workloadData = await publicClient.readContract({
              address: WORKLOAD_REGISTRY_ADDRESS,
              abi: WorkloadRegistryAbi,
              functionName: 'getWorkload',
              args: [workloadId],
            }) as {
              id: bigint;
              owner: `0x${string}`;
              metadataUri: string;
              status: number;
              registeredAt: bigint;
              updatedAt: bigint;
              placementProvider: string;
              placementInstanceId: bigint;
            };

            const status = Number(workloadData.status ?? 0);
            const createdAt = Number(workloadData.registeredAt ?? 0);
            const updatedAt = Number(workloadData.updatedAt ?? 0);
            const manifestCID = typeof workloadData.metadataUri === 'string' ? workloadData.metadataUri : '';
            const pubKeyHash = workloadData.placementProvider || '';

            return {
              jobId: workloadId,
              user: workloadData.owner || address || '',
              pubKeyHash,
              deposited: BigInt(0),
              spent: BigInt(0),
              remaining: BigInt(0),
              nonce: BigInt(0),
              status,
              createdAt,
              closedAt: status === 0 ? updatedAt : 0,
              transactionHash: workloadTxMap.get(workloadId) || '',
              manifestCID,
            } as UserJob;
          } catch (err) {
            L.error(`Failed to fetch details for workload ${workloadId}:`, err);
            return null;
          }
        })
      );

      const validJobs = jobsWithDetails
        .filter((job): job is UserJob => job !== null)
        .sort((a: UserJob, b: UserJob) => Number(b.createdAt) - Number(a.createdAt));

      validJobs.forEach((job: UserJob) => {
        if (job.transactionHash) {
          seenTxHashes.add(job.transactionHash);
        }
      });
      setJobs(validJobs);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [publicClient, address, seenTxHashes]);

  return {
    jobs,
    loading,
    error,
    refetch
  };
}
