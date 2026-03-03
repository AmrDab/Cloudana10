// Simplified wagmi config for development
// This prevents wallet-related import errors during development

export const projectId = 'demo-project-id';

export const networks = [
  {
    id: 84532,
    name: 'Base Sepolia',
    rpcUrl: 'https://sepolia.base.org',
  }
];

export const wagmiAdapter = {
  wagmiConfig: {} as any
};