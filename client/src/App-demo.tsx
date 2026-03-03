import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";

// Import pages without wallet dependencies
import LandingPage from "@/pages/landing";
import UserDashboard from "@/pages/user-dashboard";
import ProvidersExplorer from "@/pages/providers-explorer";
import { GPUPricing } from "@/pages/pricing/gpus";

// Mock wallet context
const WalletContext = React.createContext({
  isConnected: false,
  address: null,
  userAddress: '',
  balance: 0,
  isProvider: false,
  providerId: null,
  disconnect: () => {},
  registerAsProvider: () => {},
  isProviderMode: false,
  toggleProviderMode: () => {},
});

export const useWallet = () => React.useContext(WalletContext);

function App() {
  return (
    <WalletContext.Provider value={{
      isConnected: false,
      address: null,
      userAddress: '',
      balance: 0,
      isProvider: false,
      providerId: null,
      disconnect: () => {},
      registerAsProvider: () => {},
      isProviderMode: false,
      toggleProviderMode: () => {},
    }}>
      <Router>
        <div className="min-h-screen bg-background">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/dashboard" element={<UserDashboard />} />
            <Route path="/providers" element={<ProvidersExplorer />} />
            <Route path="/pricing" element={<GPUPricing />} />
            <Route path="*" element={
              <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
                <div className="text-center">
                  <h1 className="text-4xl font-bold mb-4">🚀 Cloudana DePIN Testnet</h1>
                  <p className="text-xl mb-4">Decentralized Compute Marketplace</p>
                  <div className="bg-blue-900/50 border border-blue-500/50 rounded-lg p-4">
                    <h2 className="text-lg font-semibold text-blue-400 mb-2">✅ Platform Operational</h2>
                    <ul className="space-y-1 text-sm text-left">
                      <li>• Landing Page: Available at <a href="/" className="text-blue-400 underline">/</a></li>
                      <li>• User Dashboard: <a href="/dashboard" className="text-blue-400 underline">/dashboard</a></li>
                      <li>• Provider Explorer: <a href="/providers" className="text-blue-400 underline">/providers</a></li>
                      <li>• GPU Pricing: <a href="/pricing" className="text-blue-400 underline">/pricing</a></li>
                    </ul>
                  </div>
                  <p className="mt-4 text-gray-400 text-sm">
                    Wallet functionality temporarily disabled for stable access
                  </p>
                </div>
              </div>
            } />
          </Routes>
          <Toaster />
        </div>
      </Router>
    </WalletContext.Provider>
  );
}

export default App;