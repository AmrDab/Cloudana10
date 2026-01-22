import { useEffect, useState, useCallback } from 'react';
import { usePublicClient, useWatchContractEvent, useAccount } from 'wagmi';
import { JOB_ESCROW_ADDRESS, CHAIN_ID } from '@/lib/contracts';
import { JobEscrowAbi } from '@shared/contracts';
import { formatEther } from 'viem';

export interface UserJob {
  jobId: bigint;
  user: string;
  pubKeyHash: string;
  deposited: bigint;
  spent: bigint;
  remaining: bigint;
  nonce: bigint;
  status: number; // 0 = OPEN, 1 = CLOSED
  createdAt: number;
  closedAt: number;
  transactionHash: string;
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

  // Format event data for display
  const formatJobEvent = useCallback((data: {
    jobId: bigint;
    user: string;
    pubKeyHash: string;
    budgetAmount: bigint;
    blockNumber: bigint;
    transactionHash: string;
    timestamp?: bigint;
  }): UserJob => {
    return {
      jobId: data.jobId,
      user: data.user,
      pubKeyHash: data.pubKeyHash,
      deposited: data.budgetAmount,
      spent: BigInt(0), // Will be updated when we fetch job details
      remaining: data.budgetAmount,
      nonce: BigInt(0),
      status: 0, // OPEN
      createdAt: data.timestamp ? Number(data.timestamp) : Date.now() / 1000,
      closedAt: 0,
      transactionHash: data.transactionHash,
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

  // Watch for new JobCreated events for this user
  useWatchContractEvent({
    address: JOB_ESCROW_ADDRESS,
    abi: JobEscrowAbi,
    eventName: 'JobCreated',
    chainId: CHAIN_ID,
    enabled: enabled && !!address,
    onLogs(logs) {
      logs.forEach((log: any) => {
        // Only process jobs for the current user
        if (log.args.user?.toLowerCase() === address?.toLowerCase()) {
          console.log('[useUserJobs] 🎉 New job created:', log);
          
          const formatted = formatJobEvent({
            jobId: log.args.jobId,
            user: log.args.user,
            pubKeyHash: log.args.pubKeyHash,
            budgetAmount: log.args.budgetAmount,
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
          });
          
          addJob(formatted);
        }
      });
    },
  });

  // Load historical events and fetch job details
  useEffect(() => {
    if (!enabled || !publicClient || !address) {
      setLoading(false);
      return;
    }

    const loadUserJobs = async () => {
      try {
        setLoading(true);
        setError(null);

        console.log('[useUserJobs] Fetching historical job events from blockchain...');
        
        // Get all JobCreated events
        const logs = await publicClient.getContractEvents({
          address: JOB_ESCROW_ADDRESS,
          abi: JobEscrowAbi,
          eventName: 'JobCreated',
          args: {
            user: address,
          },
          fromBlock: 'earliest',
          toBlock: 'latest',
        });

        console.log(`[useUserJobs] ✓ Loaded ${logs.length} historical jobs`);

        // Fetch full job details for each job
        const jobsWithDetails = await Promise.all(
          logs.map(async (log: any) => {
            try {
              // Get job details from contract
              const jobData = await publicClient.readContract({
                address: JOB_ESCROW_ADDRESS,
                abi: JobEscrowAbi,
                functionName: 'jobs',
                args: [log.args.jobId],
              }) as readonly [string, string, bigint, bigint, bigint, bigint, number, number, number];

              const deposited = jobData[3] || BigInt(0);
              const spent = jobData[4] || BigInt(0);
              const remaining = deposited - spent;

              return {
                jobId: log.args.jobId,
                user: log.args.user,
                pubKeyHash: log.args.pubKeyHash,
                deposited,
                spent,
                remaining,
                nonce: jobData[5] || BigInt(0),
                status: Number(jobData[6] || 0),
                createdAt: Number(jobData[7] || 0),
                closedAt: Number(jobData[8] || 0),
                transactionHash: log.transactionHash,
              } as UserJob;
            } catch (err) {
              console.warn(`[useUserJobs] Failed to fetch details for job ${log.args.jobId}:`, err);
              return null;
            }
          })
        );

        const validJobs = jobsWithDetails
          .filter((job): job is UserJob => job !== null)
          .reverse(); // Most recent first

        validJobs.forEach(job => seenTxHashes.add(job.transactionHash));
        setJobs(validJobs);
      } catch (err: any) {
        console.error('[useUserJobs] Error fetching historical:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadUserJobs();
  }, [enabled, publicClient, address, formatJobEvent, seenTxHashes]);

  // Manual refetch
  const refetch = useCallback(async () => {
    if (!publicClient || !address) return;
    
    try {
      setLoading(true);
      const logs = await publicClient.getContractEvents({
        address: JOB_ESCROW_ADDRESS,
        abi: JobEscrowAbi,
        eventName: 'JobCreated',
        args: {
          user: address,
        },
        fromBlock: 'earliest',
        toBlock: 'latest',
      });

      const jobsWithDetails = await Promise.all(
        logs.map(async (log: any) => {
          try {
            const jobData = await publicClient.readContract({
              address: JOB_ESCROW_ADDRESS,
              abi: JobEscrowAbi,
              functionName: 'jobs',
              args: [log.args.jobId],
            }) as readonly [string, string, bigint, bigint, bigint, bigint, number, number, number];

            const deposited = jobData[3] || BigInt(0);
            const spent = jobData[4] || BigInt(0);
            const remaining = deposited - spent;

            return {
              jobId: log.args.jobId,
              user: log.args.user,
              pubKeyHash: log.args.pubKeyHash,
              deposited,
              spent,
              remaining,
              nonce: jobData[5] || BigInt(0),
              status: Number(jobData[6] || 0),
              createdAt: Number(jobData[7] || 0),
              closedAt: Number(jobData[8] || 0),
              transactionHash: log.transactionHash,
            } as UserJob;
          } catch (err) {
            return null;
          }
        })
      );

      const validJobs = jobsWithDetails
        .filter((job): job is UserJob => job !== null)
        .reverse();

      setJobs(validJobs);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [publicClient, address]);

  return {
    jobs,
    loading,
    error,
    refetch
  };
}
