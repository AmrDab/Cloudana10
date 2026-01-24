import { Suspense } from "react";
import { Switch, Route } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { WalletProvider } from "@/context/wallet-context";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import ProviderRegister from "@/pages/provider-register";
import ProviderListPage from "@/pages/provider-list";
import ProviderDetailPageWrapper from "@/pages/provider-detail-wrapper";
import ProviderRawPageWrapper from "@/pages/provider-raw-wrapper";
import UserDashboard from "@/pages/user-dashboard";
import DebugPanel from "@/pages/debug-panel";
import JobDetailPageWrapper from "@/pages/job-detail-wrapper";
import DeploymentCom from "@/pages/deployment-com";
import GpuPricingPage from "@/pages/pricing/gpus";
import GpusOnDemandPage from "@/pages/pricing/gpus-on-demand";
import UsageCalculatorPage from "@/pages/pricing/usage-calculator";
import ProviderCalculatorPage from "@/pages/pricing/provider-calculator";

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/user" component={UserDashboard} />
        <Route path="/provider" component={ProviderRegister} />
        <Route path="/providers/:owner/raw" component={ProviderRawPageWrapper} />
        <Route path="/providers/:owner" component={ProviderDetailPageWrapper} />
        <Route path="/providers" component={ProviderListPage} />
        <Route path="/job/:id" component={JobDetailPageWrapper} />
        <Route path="/deployment-completion" component={DeploymentCom} />
        <Route path="/pricing/gpus" component={GpuPricingPage} />
        <Route path="/pricing/gpus-on-demand" component={GpusOnDemandPage} />
        <Route path="/pricing/usage" component={UsageCalculatorPage} />
        <Route path="/pricing/provider" component={ProviderCalculatorPage} />
        <Route path="/debug" component={DebugPanel} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
        <WalletProvider>
          <Router />
          <Toaster />
        </WalletProvider>
      </Suspense>
    </ErrorBoundary>
  );
}

export default App;
