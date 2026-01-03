import React, { createContext, useContext, useState, ReactNode, useMemo } from 'react';
import { WagmiProvider, useAccount, useBalance, useDisconnect } from 'wagmi';
import { QueryClientProvider } from '@tanstack/react-query';
import { createAppKit } from '@reown/appkit/react';
import { baseSepolia } from '@reown/appkit/networks';
import { wagmiAdapter, projectId, networks } from '@/lib/wagmi-config';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

const metadata = {
  name: 'Cloudana',
  description: 'Decentralized Compute Marketplace on Base Sepolia',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://cloudana.app',
  icons: ['https://cloudana.app/icon.png']
};

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  metadata,
  projectId,
  features: {
    analytics: true,
  },
  themeMode: 'dark',
});

interface WalletContextType {
  isConnected: boolean;
  address: string | null;
  userAddress: string;
  balance: number;
  isProvider: boolean;
  providerId: string | null;
  disconnect: () => void;
  registerAsProvider: (metadata: string) => void;
  isProviderMode: boolean;
  toggleProviderMode: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

function WalletContextProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { data: balanceData } = useBalance({ address });
  const { toast } = useToast();
  
  const [isProvider, setIsProvider] = useState(false);
  const [isProviderMode, setIsProviderMode] = useState(false);

  const disconnect = () => {
    wagmiDisconnect();
    setIsProviderMode(false);
    toast({
      title: "Wallet Disconnected",
    });
  };

  const registerAsProvider = (metadata: string) => {
    setTimeout(() => {
      setIsProvider(true);
      toast({
        title: "Provider Registered",
        description: "Transaction confirmed: You are now a registered provider.",
      });
    }, 1000);
  };

  const toggleProviderMode = () => {
    setIsProviderMode(!isProviderMode);
  };

  const shortAddress = address 
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  const ethBalance = balanceData ? Number(balanceData.formatted) : 0;

  const value = useMemo(() => ({
    isConnected,
    address: shortAddress,
    userAddress: address || '',
    balance: ethBalance,
    isProvider,
    providerId: isProvider ? `prov-${address?.slice(-8)}` : null,
    disconnect,
    registerAsProvider,
    isProviderMode,
    toggleProviderMode,
  }), [isConnected, address, shortAddress, ethBalance, isProvider, isProviderMode]);

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletContextProvider>
          {children}
        </WalletContextProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
