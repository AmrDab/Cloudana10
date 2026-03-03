import React, { createContext, useContext, useState, ReactNode, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';

// Mock hook implementations to match original interface
const mockHooks = {
  useAccount: () => ({ address: null, isConnected: false, chain: null }),
  useBalance: () => ({ data: null }),
  useDisconnect: () => ({ disconnect: () => {} }),
};

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
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [isProvider, setIsProvider] = useState(false);
  const [isProviderMode, setIsProviderMode] = useState(false);
  const { toast } = useToast();

  const disconnect = () => {
    setIsConnected(false);
    setAddress(null);
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

  const value = useMemo(() => ({
    isConnected,
    address: shortAddress,
    userAddress: address || '',
    balance: 0,
    isProvider,
    providerId: isProvider ? `prov-${address?.slice(-8)}` : null,
    disconnect,
    registerAsProvider,
    isProviderMode,
    toggleProviderMode,
  }), [isConnected, address, shortAddress, isProvider, isProviderMode]);

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WalletContextProvider>
      {children}
    </WalletContextProvider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}