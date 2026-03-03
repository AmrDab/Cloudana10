import { useEffect, useState, useCallback } from 'react';
import { usePublicClient, useWatchContractEvent } from 'wagmi';
import { CHAIN_ID, PROVIDER_REGISTRY_ADDRESS } from '@/lib/contracts';
import { ProviderRegistryAbi } from '@shared/contracts';

export interface ProviderEvent {
  id: string;
  owner: string;
  ownerShort: string;
  pubKeyHash: string;
  pubKeyHashShort: string;
  ipfsCID: string;
  bondAmount: string;
  bondAmountFormatted: string;
  region: string;
  hardwareTier: number;
  capacity: number;
  blockNumber: number;
  transactionHash: string;
  timestamp: string;
}

interface UseProviderEventsOptions {
  enabled?: boolean;
  loadHistorical?: boolean;
  onNewProvider?: (provider: ProviderEvent) => void;
}

interface UseProviderEventsReturn {
  providers: ProviderEvent[];
  loading: boolean;
  error: string | null;
  connected: boolean;
  refetch: () => Promise<void>;
}

export function useProviderEvents(options: UseProviderEventsOptions = {}): UseProviderEventsReturn {
  const { enabled = true, loadHistorical = true, onNewProvider } = options;

  const [providers, setProviders] = useState<ProviderEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [seenTxHashes] = useState(new Set<string>());

  const publicClient = usePublicClient({ chainId: CHAIN_ID });

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
      region: 'Global',
      hardwareTier: 0,
      capacity: 1,
      blockNumber: Number(data.blockNumber),
      transactionHash: data.transactionHash,
      timestamp: data.timestamp ? new Date(Number(data.timestamp) * 1000).toLocaleString() : new Date().toLocaleString(),
    };
  }, []);

  const addProvider = useCallback((provider: ProviderEvent) => {
    if (seenTxHashes.has(provider.transactionHash)) {
      return;
    }

    seenTxHashes.add(provider.transactionHash);
    setProviders(prev => [provider, ...prev]);

    if (onNewProvider) {
      onNewProvider(provider);
    }
  }, [onNewProvider, seenTxHashes]);

  useWatchContractEvent({
    address: PROVIDER_REGISTRY_ADDRESS,
    abi: ProviderRegistryAbi,
    eventName: 'ProviderRegistered',
    chainId: CHAIN_ID,
    enabled,
    onLogs(logs) {
      setConnected(true);
      logs.forEach((log: any) => {
        const formatted = formatProviderEvent({
          owner: log.args.owner,
          pubKeyHash: log.args.pubKeyHash,
          ipfsCID: log.args.ipfsCID,
          bondAmount: log.args.bondAmount ?? 0n,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
        });

        addProvider(formatted);
      });
    },
  });

  const loadHistoricalEvents = useCallback(async () => {
    if (!enabled || !publicClient) return;

    try {
      setLoading(true);
      setError(null);

      const logs = await publicClient.getContractEvents({
        address: PROVIDER_REGISTRY_ADDRESS,
        abi: ProviderRegistryAbi,
        eventName: 'ProviderRegistered',
        fromBlock: 'earliest',
        toBlock: 'latest',
      });

      const formattedProviders = logs.map((log: any) => {
        const formatted = formatProviderEvent({
          owner: log.args.owner,
          pubKeyHash: log.args.pubKeyHash,
          ipfsCID: log.args.ipfsCID,
          bondAmount: log.args.bondAmount ?? 0n,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
        });

        seenTxHashes.add(formatted.transactionHash);
        return formatted;
      });

      setProviders(formattedProviders.reverse());
      setConnected(true);
    } catch (err: any) {
      console.error('[useProviderEvents] Error fetching historical:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [enabled, publicClient, formatProviderEvent, seenTxHashes]);

  useEffect(() => {
    if (loadHistorical) {
      loadHistoricalEvents();
    } else {
      setLoading(false);
      setConnected(!!publicClient);
    }
  }, [loadHistorical, loadHistoricalEvents, publicClient]);

  return {
    providers,
    loading,
    error,
    connected,
    refetch: loadHistoricalEvents,
  };
}
