import { Switch, Route } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { WalletProvider } from "@/context/wallet-context";
import { AppLayout } from "@/components/layout/AppLayout";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import UserDashboard from "@/pages/user-dashboard";
import ProviderDashboard from "@/pages/provider-dashboard";
import JobDetail from "@/pages/job-detail";
import ProvidersExplorer from "@/pages/providers-explorer";
import DebugPanel from "@/pages/debug-panel";

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/user" component={UserDashboard} />
        <Route path="/provider" component={ProviderDashboard} />
        <Route path="/job/:id" component={JobDetail} />
        <Route path="/jobs" component={ProvidersExplorer} />
        <Route path="/providers" component={ProvidersExplorer} />
        <Route path="/debug" component={DebugPanel} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <WalletProvider>
      <Router />
      <Toaster />
    </WalletProvider>
  );
}

export default App;
