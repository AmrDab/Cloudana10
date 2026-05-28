import { Suspense, useEffect, lazy } from "react";
import { Router as WouterRouter, Switch, Route, useLocation } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { WalletProvider } from "@/context/wallet-context";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import ProviderRegister from "@/pages/provider-register";
import ProviderRegisterPage from "@/pages/provider-register-page";
import ProviderRegisterMultistep from "@/pages/provider-register-multistep";
import ProviderBuildCluster from "@/pages/provider-build-cluster";
import ProviderListPage from "@/pages/provider-list";
import ProviderDetailPageWrapper from "@/pages/provider-detail-wrapper";
import ProviderRawPageWrapper from "@/pages/provider-raw-wrapper";
import ProviderUpdatePageWrapper from "@/pages/provider-update-wrapper";
import UserDashboard from "@/pages/user-dashboard";
import DebugPanel from "@/pages/debug-panel";
import JobDetailPageWrapper from "@/pages/job-detail-wrapper";
import DeploymentCom from "@/pages/deployment-com";
import GpuPricingPage from "@/pages/pricing/gpus";
import GpusOnDemandPage from "@/pages/pricing/gpus-on-demand";
import UsageCalculatorPage from "@/pages/pricing/usage-calculator";
import ProviderCalculatorPage from "@/pages/pricing/provider-calculator";
import WorkloadRegister from "@/pages/workload-register";
import MiningDashboard from "@/pages/mining-dashboard";
import DocsPage from "@/pages/docs";
import LitepaperPage from "@/pages/litepaper";
import FaucetPage from "@/pages/faucet";
import DecentralizationPage from "@/pages/decentralization";

function RedirectToProviderRegister() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    const q = typeof window !== "undefined" ? window.location.search : "";
    setLocation(`/provider/register${q || ""}`);
  }, [setLocation]);
  return null;
}

function AppRouter() {
  const [location] = useLocation();
  const isHomeRoute = location === "/" || location.startsWith("/?");

  if (isHomeRoute) {
    return <LandingPage />;
  }

  return (
    <AppLayout>
      <Switch>
        <Route path="/user" component={UserDashboard} />
        <Route path="/mining" component={MiningDashboard} />
        <Route path="/provider" component={ProviderRegisterPage} />
        <Route path="/provider/register" component={ProviderRegisterPage} />
        <Route path="/register" component={RedirectToProviderRegister} />
        <Route path="/provider/register/build-cluster">{() => <ProviderBuildCluster />}</Route>
        <Route path="/provider/register/final" component={ProviderRegister} />
        <Route path="/providers/:owner/edit" component={ProviderUpdatePageWrapper} />
        <Route path="/providers/:owner/logs" component={lazy(() => import("./pages/provider-logs"))} />
        <Route path="/providers/:owner/raw" component={ProviderRawPageWrapper} />
        <Route path="/providers/:owner" component={ProviderDetailPageWrapper} />
        <Route path="/providers" component={ProviderListPage} />
        <Route path="/job/:id" component={JobDetailPageWrapper} />
        <Route path="/workload/register" component={WorkloadRegister} />
        <Route path="/deployment-completion" component={DeploymentCom} />
        <Route path="/pricing/gpus" component={GpuPricingPage} />
        <Route path="/pricing/gpus-on-demand" component={GpusOnDemandPage} />
        <Route path="/pricing/usage" component={UsageCalculatorPage} />
        <Route path="/pricing/provider" component={ProviderCalculatorPage} />
        <Route path="/docs" component={DocsPage} />
        <Route path="/litepaper" component={LitepaperPage} />
        <Route path="/faucet" component={FaucetPage} />
        <Route path="/decentralization" component={DecentralizationPage} />
        <Route path="/debug" component={DebugPanel} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  // Serve landing page at the actual root path (outside /control base)
  const rawPath = typeof window !== "undefined" ? window.location.pathname : "/";
  const isRootLanding = rawPath === "/" || rawPath === "";

  if (isRootLanding) {
    return (
      <ErrorBoundary>
        <WalletProvider>
          <LandingPage />
          <Toaster />
        </WalletProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
        <WouterRouter base="/control">
          <WalletProvider>
            <AppRouter />
            <Toaster />
          </WalletProvider>
        </WouterRouter>
      </Suspense>
    </ErrorBoundary>
  );
}

export default App;
