import { useEffect, useState, useCallback } from 'react';
import { usePublicClient } from 'wagmi';
import { CHAIN_ID } from '@/lib/contracts';
// NOTE: ProviderRegistry contract is not built yet - this hook is disabled
// import { ProviderRegistryAbi } from '@shared/contracts';

export interface ProviderEvent {
  id: string;
  owner: string;
  ownerShort: string;
  pubKeyHash: string;
  pubKeyHashShort: string;
  ipfsCID: string;
  bondAmount: string;
  bondAmountFormatted: string;
  blockNumber: number;
  transactionHash: string;
  timestamp: string;
}

interface UseProviderEventsOptions {
  enabled?: boolean;
  onNewProvider?: (provider: ProviderEvent) => void;
}

interface UseProviderEventsReturn {
  providers: ProviderEvent[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Real-time hook for listening to ProviderRegistered events directly from blockchain
 * 
 * DePIN Architecture: Direct blockchain connection - no backend needed
 * 
 * Benefits:
 * - True decentralization
 * - No backend server required
 * - Direct on-chain data
 * - Real-time event listening via wagmi
 * 
 * @example
 * ```tsx
 * const { providers, loading } = useProviderEvents({
 *   onNewProvider: (provider) => {
 *     toast.success(`New provider: ${provider.ipfsCID}`);
 *   }
 * });
 * ```
 */
export function useProviderEvents(
  options: UseProviderEventsOptions = {}
): UseProviderEventsReturn {
  const {
    enabled = true,
    onNewProvider
  } = options;

  const [providers, setProviders] = useState<ProviderEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seenTxHashes] = useState(new Set<string>());

  const publicClient = usePublicClient({ chainId: CHAIN_ID });

  // Format event data for display
  const formatProviderEvent = useCallback((data: {
    owner: string;
    pubKeyHash: string;
    ipfsCID: string;
    bondAmount: bigint;
    blockNumber: bigint;
    transactionHash: string;
    timestamp?: bigint;
  }): ProviderEvent => {
    const bondAmountFormatted = (Number(data.bondAmount) / 1e18).toFixed(2);
    
    return {
      id: `${data.transactionHash}-${data.blockNumber}`,
      owner: data.owner,
      ownerShort: `${data.owner.slice(0, 6)}...${data.owner.slice(-4)}`,
      pubKeyHash: data.pubKeyHash,
      pubKeyHashShort: `${data.pubKeyHash.slice(0, 10)}...${data.pubKeyHash.slice(-8)}`,
      ipfsCID: data.ipfsCID,
      bondAmount: data.bondAmount.toString(),
      bondAmountFormatted,
      blockNumber: Number(data.blockNumber),
      transactionHash: data.transactionHash,
      timestamp: data.timestamp ? new Date(Number(data.timestamp) * 1000).toLocaleString() : new Date().toLocaleString()
    };
  }, []);

  // Add provider with deduplication
  const addProvider = useCallback((provider: ProviderEvent) => {
    if (seenTxHashes.has(provider.transactionHash)) {
      return; // Already processed
    }
    
    seenTxHashes.add(provider.transactionHash);
    setProviders(prev => [provider, ...prev]);
    
    if (onNewProvider) {
      onNewProvider(provider);
    }
  }, [onNewProvider, seenTxHashes]);

  // NOTE: ProviderRegistry contract is not built yet - event watching is disabled
  // When ProviderRegistry is available, uncomment this:
  // useWatchContractEvent({
  //   address: PROVIDER_REGISTRY_ADDRESS,
  //   abi: ProviderRegistryAbi,
  //   eventName: 'ProviderRegistered',
  //   chainId: CHAIN_ID,
  //   enabled,
  //   onLogs(logs) {
  //     logs.forEach((log: any) => {
  //       console.log('[useProviderEvents] 🎉 New provider registered:', log);
  //       
  //       const formatted = formatProviderEvent({
  //         owner: log.args.owner,
  //         pubKeyHash: log.args.pubKeyHash,
  //         ipfsCID: log.args.ipfsCID,
  //         bondAmount: log.args.bondAmount,
  //         blockNumber: log.blockNumber,
  //         transactionHash: log.transactionHash,
  //       });
  //       
  //       addProvider(formatted);
  //     });
  //   },
  // });

  // Load historical events on mount
  useEffect(() => {
    if (!enabled || !publicClient) {
      return;
    }

    const loadHistoricalEvents = async () => {
      try {
        setLoading(true);
        setError(null);

        // NOTE: ProviderRegistry contract is not built yet - returning empty array
        console.log('[useProviderEvents] ProviderRegistry contract not available - returning empty providers list');
        
        // When ProviderRegistry is available, uncomment this:
        // const logs = await publicClient.getContractEvents({
        //   address: PROVIDER_REGISTRY_ADDRESS,
        //   abi: ProviderRegistryAbi,
        //   eventName: 'ProviderRegistered',
        //   fromBlock: 'earliest',
        //   toBlock: 'latest',
        // });
        // 
        // console.log(`[useProviderEvents] ✓ Loaded ${logs.length} historical providers`);
        // 
        // const formattedProviders = logs.map((log: any) => {
        //   const formatted = formatProviderEvent({
        //     owner: log.args.owner,
        //     pubKeyHash: log.args.pubKeyHash,
        //     ipfsCID: log.args.ipfsCID,
        //     bondAmount: log.args.bondAmount,
        //     blockNumber: log.blockNumber,
        //     transactionHash: log.transactionHash,
        //   });
        //   
        //   seenTxHashes.add(formatted.transactionHash);
        //   return formatted;
        // });
        // 
        // setProviders(formattedProviders.reverse()); // Most recent first
        
        setProviders([]); // Return empty array until ProviderRegistry is available
      } catch (err: any) {
        console.error('[useProviderEvents] Error fetching historical:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadHistoricalEvents();
  }, [enabled, publicClient, formatProviderEvent, seenTxHashes]);

  // Manual refetch
  const refetch = useCallback(async () => {
    if (!publicClient) return;
    
    try {
      setLoading(true);
      // NOTE: ProviderRegistry contract is not built yet - returning empty array
      console.log('[useProviderEvents] ProviderRegistry contract not available - refetch returns empty');
      
      // When ProviderRegistry is available, uncomment this:
      // const logs = await publicClient.getContractEvents({
      //   address: PROVIDER_REGISTRY_ADDRESS,
      //   abi: ProviderRegistryAbi,
      //   eventName: 'ProviderRegistered',
      //   fromBlock: 'earliest',
      //   toBlock: 'latest',
      // });
      // 
      // const formattedProviders = logs.map((log: any) => 
      //   formatProviderEvent({
      //     owner: log.args.owner,
      //     pubKeyHash: log.args.pubKeyHash,
      //     ipfsCID: log.args.ipfsCID,
      //     bondAmount: log.args.bondAmount,
      //     blockNumber: log.blockNumber,
      //     transactionHash: log.transactionHash,
      //   })
      // );
      // 
      // setProviders(formattedProviders.reverse());
      
      setProviders([]); // Return empty array until ProviderRegistry is available
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [publicClient, formatProviderEvent]);

  return {
    providers,
    loading,
    error,
    refetch
  };
}
