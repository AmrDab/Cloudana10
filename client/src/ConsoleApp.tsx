// The console (/control/*) — its own bundle, so the homepage never loads the wallet stack.
import { useEffect, lazy } from "react";
import { Router as WouterRouter, Switch, Route, Redirect, useLocation, useSearch } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { WalletProvider } from "@/context/wallet-context";
import { ConsoleLayout } from "@/components/console/ConsoleLayout";
import { LegacyShell } from "@/components/console/LegacyShell";
import NotFound from "@/pages/not-found";
import OverviewPage from "@/pages/console/overview";
import RunPage from "@/pages/console/run";
import ProvidePage from "@/pages/console/provide";
import VerifyPage from "@/pages/console/verify";
import ServicesPage from "@/pages/console/services";
import EarningsPage from "@/pages/console/earnings";
import EconomicsPage from "@/pages/console/economics";
import ProviderDetailPageWrapper from "@/pages/provider-detail-wrapper";
import ProviderRawPageWrapper from "@/pages/provider-raw-wrapper";
import ProviderUpdatePageWrapper from "@/pages/provider-update-wrapper";
import UserDashboard from "@/pages/user-dashboard";
import DebugPanel from "@/pages/debug-panel";
import JobDetailPageWrapper from "@/pages/job-detail-wrapper";
import DeploymentCom from "@/pages/deployment-com";
import UsageCalculatorPage from "@/pages/pricing/usage-calculator";
import ProviderCalculatorPage from "@/pages/pricing/provider-calculator";
import WorkloadRegister from "@/pages/workload-register";
import DocsPage from "@/pages/console/docs";
import LegacyDocsPage from "@/pages/docs";
import LitepaperPage from "@/pages/litepaper";
import DecentralizationPage from "@/pages/decentralization";

const ProviderLogs = lazy(() => import("./pages/provider-logs"));

/** Old console paths → the same page under /legacy (query string kept). */
const LEGACY_PREFIXES = ["/user", "/mining", "/provider", "/providers", "/register", "/job", "/workload", "/deployment-completion", "/pricing", "/decentralization", "/debug"];
function ToLegacy() {
  const [loc] = useLocation();
  const search = useSearch();
  return <Redirect to={`/legacy${loc}${search ? `?${search}` : ""}`} replace />;
}

/** The current litepaper is the static page; the old React one lives under /legacy/litepaper. */
function ToStaticLitepaper() {
  useEffect(() => window.location.replace("/litepaper.html"), []);
  return null;
}

/**
 * The v0 pages that are still useful, unchanged, inside the old layout with a "new console is at …"
 * banner. Marketplace-era pages (on-chain provider registration and its build-cluster wizard, the
 * provider list, GPU "market rate" pricing) are retired and redirect to their successor.
 */
function LegacyRoutes() {
  return (
    <LegacyShell>
      <Switch>
        <Route path="/user" component={UserDashboard} />
        <Route path="/mining">{() => <Redirect to="~/control/earnings" replace />}</Route>
        <Route path="/provider" nest>{() => <Redirect to="~/control/provide" replace />}</Route>
        <Route path="/register">{() => <Redirect to="~/control/provide" replace />}</Route>
        <Route path="/providers">{() => <Redirect to="~/control/provide" replace />}</Route>
        <Route path="/providers/:owner/edit" component={ProviderUpdatePageWrapper} />
        <Route path="/providers/:owner/logs" component={ProviderLogs} />
        <Route path="/providers/:owner/raw" component={ProviderRawPageWrapper} />
        <Route path="/providers/:owner" component={ProviderDetailPageWrapper} />
        <Route path="/job/:id" component={JobDetailPageWrapper} />
        <Route path="/workload/register" component={WorkloadRegister} />
        <Route path="/deployment-completion" component={DeploymentCom} />
        <Route path="/pricing/gpus">{() => <Redirect to="~/control/run" replace />}</Route>
        <Route path="/pricing/gpus-on-demand">{() => <Redirect to="~/control/run" replace />}</Route>
        <Route path="/pricing/usage" component={UsageCalculatorPage} />
        <Route path="/pricing/provider" component={ProviderCalculatorPage} />
        <Route path="/decentralization" component={DecentralizationPage} />
        <Route path="/docs" component={LegacyDocsPage} />
        <Route path="/litepaper" component={LitepaperPage} />
        <Route path="/debug" component={DebugPanel} />
        <Route component={NotFound} />
      </Switch>
    </LegacyShell>
  );
}

function AppRouter() {
  const [location] = useLocation();
  if (LEGACY_PREFIXES.some((p) => location === p || location.startsWith(p + "/"))) return <ToLegacy />;
  return (
    <Switch>
      <Route path="/legacy" nest>
        <LegacyRoutes />
      </Route>
      <Route>
        <ConsoleLayout>
          <Switch>
            <Route path="/" component={OverviewPage} />
            <Route path="/run" component={RunPage} />
            <Route path="/provide" component={ProvidePage} />
            <Route path="/verify" component={VerifyPage} />
            <Route path="/services" component={ServicesPage} />
            <Route path="/earnings" component={EarningsPage} />
            <Route path="/economics" component={EconomicsPage} />
            <Route path="/docs" component={DocsPage} />
            <Route path="/litepaper" component={ToStaticLitepaper} />
            {/* The on-chain faucet is gone; test credits live in the console. */}
            <Route path="/faucet">{() => <Redirect to="/run" replace />}</Route>
            <Route component={NotFound} />
          </Switch>
        </ConsoleLayout>
      </Route>
    </Switch>
  );
}

export default function ConsoleApp() {
  return (
    <WouterRouter base="/control">
      <WalletProvider>
        <AppRouter />
        <Toaster />
      </WalletProvider>
    </WouterRouter>
  );
}
