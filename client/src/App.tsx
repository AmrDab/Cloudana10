import { Suspense } from "react";
import { Switch, Route } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { WalletProvider } from "@/context/wallet-context";
import { AppLayout } from "@/components/layout/AppLayout";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import ProviderDashboard from "@/pages/provider-dashboard";
import ProviderRegister from "@/pages/provider-register";
import ProviderListPage from "@/pages/provider-list";
import ProviderDetailPage from "@/pages/provider-detail";
import ProviderRawPage from "@/pages/provider-raw";
import UserDashboard from "@/pages/user-dashboard";
import DebugPanel from "@/pages/debug-panel";

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/user" component={UserDashboard} />
        <Route path="/provider" component={ProviderDashboard} />
        <Route path="/provider/register" component={ProviderRegister} />
        <Route path="/providers/:owner/raw" component={ProviderRawPage} />
        <Route path="/providers/:owner" component={ProviderDetailPage} />
        <Route path="/providers" component={ProviderListPage} />
        <Route path="/debug" component={DebugPanel} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <WalletProvider>
        <Router />
        <Toaster />
      </WalletProvider>
    </Suspense>
  );
}

export default App;
