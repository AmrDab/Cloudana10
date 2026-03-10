import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { baseSepolia } from '@reown/appkit/networks';
import { http } from 'viem';

export const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'demo-project-id';

export const networks = [baseSepolia] as any;

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  transports: {
    [baseSepolia.id]: http('https://sepolia.base.org'),
  },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
