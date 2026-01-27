import { useEffect, useState, useCallback } from 'react';
import { usePublicClient, useAccount } from 'wagmi';
import { CHAIN_ID, WORKLOAD_REGISTRY_ADDRESS } from '@/lib/contracts';
import { WorkloadRegistryAbi } from '@shared/contracts';

export interface UserJob {
  jobId: bigint; // workloadId
  user: string; // owner address
  pubKeyHash: string; // provider pubKeyHash (from instances if available)
  deposited: bigint; // Not available in WorkloadRegistry - set to 0
  spent: bigint; // Not available in WorkloadRegistry - set to 0
  remaining: bigint; // Not available in WorkloadRegistry - set to 0
  nonce: bigint; // Not available in WorkloadRegistry - set to 0
  status: number; // WorkloadStatus enum: 0 = Pending, 1 = Active, 2 = Terminated
  createdAt: number; // createdAt timestamp
  closedAt: number; // updatedAt timestamp (if terminated)
  transactionHash: string;
  manifestHash: string; // Added for workload tracking
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
    manifestHash?: string;
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
      manifestHash: data.manifestHash || '',
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

        console.log('[useUserJobs] Fetching user workloads from blockchain...');
        console.log('[useUserJobs] User address:', address);
        console.log('[useUserJobs] Contract address:', WORKLOAD_REGISTRY_ADDRESS);
        
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
          console.log(`[useUserJobs] ✓ getUserWorkloads returned ${workloadIds.length} workload IDs:`, workloadIds.map(id => id.toString()));
        } catch (err) {
          console.error('[useUserJobs] getUserWorkloads failed:', err);
          throw new Error('Failed to fetch workload IDs from contract');
        }
        
        if (workloadIds.length === 0) {
          console.log('[useUserJobs] No workloads found for user');
          setJobs([]);
          setLoading(false);
          return;
        }
        
        // Step 2: Optionally fetch events to get transaction hashes (non-blocking, don't fail if it times out)
        const workloadTxMap = new Map<bigint, string>();
        try {
          // Only fetch recent events (last 10000 blocks) to avoid timeout
          const currentBlock = await publicClient.getBlockNumber();
          const fromBlock = currentBlock > BigInt(10000) ? currentBlock - BigInt(10000) : BigInt(0);
          
          const logs = await Promise.race([
            publicClient.getContractEvents({
              address: WORKLOAD_REGISTRY_ADDRESS,
              abi: WorkloadRegistryAbi,
              eventName: 'WorkloadCreated',
              args: {
                owner: address,
              },
              fromBlock: fromBlock,
              toBlock: 'latest',
            }),
            // Timeout after 5 seconds
            new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 5000))
          ]);
          
          logs.forEach((log: any) => {
            if (log.args?.workloadId) {
              workloadTxMap.set(log.args.workloadId, log.transactionHash);
            }
          });
          console.log(`[useUserJobs] ✓ Found ${logs.length} recent events for transaction hashes`);
        } catch (err) {
          console.warn('[useUserJobs] Event fetching failed or timed out (non-critical):', err);
          // Continue without transaction hashes - workloads will still be displayed
        }
        
        // Step 3: Fetch workload details for each ID
        console.log(`[useUserJobs] Fetching details for ${workloadIds.length} workloads...`);

        // Fetch full workload details for each workload ID
        const jobsWithDetails = await Promise.all(
          workloadIds.map(async (workloadId: bigint) => {
            try {
              console.log(`[useUserJobs] Fetching workload ${workloadId}...`);
              
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
                manifestHash: `0x${string}`;
                requirements: any;
                status: number;
                createdAt: bigint;
                updatedAt: bigint;
                replicas: bigint;
                instances: Array<{
                  id: bigint;
                  provider: `0x${string}`;
                  status: number;
                  placedAt: bigint;
                }>;
              };

              console.log(`[useUserJobs] Workload ${workloadId} data:`, {
                id: workloadData.id?.toString(),
                owner: workloadData.owner,
                status: workloadData.status,
                createdAt: workloadData.createdAt?.toString(),
                instancesCount: workloadData.instances?.length || 0,
              });

              // Extract data from workload struct
              const status = Number(workloadData.status ?? 0);
              const createdAt = Number(workloadData.createdAt ?? 0);
              const updatedAt = Number(workloadData.updatedAt ?? 0);
              
              // Get provider from first instance if available
              let pubKeyHash = '';
              if (workloadData.instances && workloadData.instances.length > 0) {
                pubKeyHash = workloadData.instances[0].provider || '';
              }

              // Convert manifestHash bytes32 to hex string
              // Viem returns bytes32 as hex string (0x...)
              const manifestHashValue: unknown = workloadData.manifestHash;
              let manifestHash = '';
              if (manifestHashValue) {
                if (typeof manifestHashValue === 'string') {
                  manifestHash = manifestHashValue;
                } else if (typeof manifestHashValue === 'bigint') {
                  manifestHash = `0x${manifestHashValue.toString(16).padStart(64, '0')}`;
                } else {
                  // Handle other types (shouldn't happen but be safe)
                  manifestHash = String(manifestHashValue);
                }
              }

              return {
                jobId: workloadId,
                user: workloadData.owner || address || '',
                pubKeyHash: pubKeyHash,
                deposited: BigInt(0), // Not tracked in WorkloadRegistry
                spent: BigInt(0), // Not tracked in WorkloadRegistry
                remaining: BigInt(0), // Not tracked in WorkloadRegistry
                nonce: BigInt(0), // Not tracked in WorkloadRegistry
                status: status,
                createdAt: createdAt,
                closedAt: status === 2 ? updatedAt : 0, // 2 = Terminated
                transactionHash: workloadTxMap.get(workloadId) || '',
                manifestHash: manifestHash,
              } as UserJob;
            } catch (err) {
              console.error(`[useUserJobs] Failed to fetch details for workload ${workloadId}:`, err);
              return null;
            }
          })
        );

        const validJobs = jobsWithDetails
          .filter((job): job is UserJob => job !== null)
          .sort((a: UserJob, b: UserJob) => Number(b.createdAt) - Number(a.createdAt)); // Most recent first

        console.log(`[useUserJobs] ✓ Successfully loaded ${validJobs.length} workloads`);
        validJobs.forEach((job: UserJob) => {
          if (job.transactionHash) {
            seenTxHashes.add(job.transactionHash);
          }
        });
        setJobs(validJobs);
      } catch (err: any) {
        console.error('[useUserJobs] Error fetching historical:', err);
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
        const fromBlock = currentBlock > BigInt(10000) ? currentBlock - BigInt(10000) : BigInt(0);
        
        const logs = await Promise.race([
          publicClient.getContractEvents({
            address: WORKLOAD_REGISTRY_ADDRESS,
            abi: WorkloadRegistryAbi,
            eventName: 'WorkloadCreated',
            args: {
              owner: address,
            },
            fromBlock: fromBlock,
            toBlock: 'latest',
          }),
          new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 5000))
        ]);
        
        logs.forEach((log: any) => {
          if (log.args?.workloadId) {
            workloadTxMap.set(log.args.workloadId, log.transactionHash);
          }
        });
      } catch (err) {
        console.warn('[useUserJobs] Event fetching failed (non-critical):', err);
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
              manifestHash: `0x${string}`;
              requirements: any;
              status: number;
              createdAt: bigint;
              updatedAt: bigint;
              replicas: bigint;
              instances: Array<{
                id: bigint;
                provider: `0x${string}`;
                status: number;
                placedAt: bigint;
              }>;
            };

            const status = Number(workloadData.status ?? 0);
            const createdAt = Number(workloadData.createdAt ?? 0);
            const updatedAt = Number(workloadData.updatedAt ?? 0);
            
            let pubKeyHash = '';
            if (workloadData.instances && workloadData.instances.length > 0) {
              pubKeyHash = workloadData.instances[0].provider || '';
            }

            // Convert manifestHash bytes32 to hex string
            // Viem returns bytes32 as hex string (0x...)
            const manifestHashValue = workloadData.manifestHash;
            let manifestHash = '';
            if (manifestHashValue) {
              if (typeof manifestHashValue === 'string') {
                manifestHash = manifestHashValue;
              } else {
                // Handle bigint or other types
                try {
                  const valueAsBigInt = typeof manifestHashValue === 'bigint' 
                    ? manifestHashValue 
                    : BigInt(String(manifestHashValue));
                  const hexStr = valueAsBigInt.toString(16);
                  manifestHash = `0x${hexStr.padStart(64, '0')}`;
                } catch {
                  manifestHash = String(manifestHashValue);
                }
              }
            }

            return {
              jobId: workloadId,
              user: workloadData.owner || address || '',
              pubKeyHash: pubKeyHash,
              deposited: BigInt(0),
              spent: BigInt(0),
              remaining: BigInt(0),
              nonce: BigInt(0),
              status: status,
              createdAt: createdAt,
              closedAt: status === 2 ? updatedAt : 0,
              transactionHash: workloadTxMap.get(workloadId) || '',
              manifestHash: manifestHash,
            } as UserJob;
          } catch (err) {
            console.error(`[useUserJobs] Failed to fetch details for workload ${workloadId}:`, err);
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
