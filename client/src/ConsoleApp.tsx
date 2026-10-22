// The console (/control/*) — its own bundle, so the homepage never loads the wallet stack.
import { useEffect } from "react";
import { Router as WouterRouter, Switch, Route, Redirect, useLocation } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { WalletProvider } from "@/context/wallet-context";
import { ConsoleLayout } from "@/components/console/ConsoleLayout";
import NotFound from "@/pages/not-found";
import OverviewPage from "@/pages/console/overview";
import RunPage from "@/pages/console/run";
import ProvidePage from "@/pages/console/provide";
import VerifyPage from "@/pages/console/verify";
import ServicesPage from "@/pages/console/services";
import EarningsPage from "@/pages/console/earnings";
import EconomicsPage from "@/pages/console/economics";
import DocsPage from "@/pages/console/docs";

/**
 * The v0 console under /legacy is gone (B-3, owner decision 2026-10-21). Its paths, and the older ones that led to it,
 * land on their successor or the overview; first match wins. public/_redirects sends /control/legacy/* to /control too.
 */
const RETIRED: [prefix: string, to: string][] = [
  ["/mining", "/earnings"],
  ["/provider", "/provide"],
  ["/providers", "/provide"],
  ["/register", "/provide"],
  ["/pricing/gpus", "/run"],
  ["/pricing/gpus-on-demand", "/run"],
  ["/legacy", "/"],
  ["/user", "/"],
  ["/job", "/"],
  ["/workload", "/"],
  ["/deployment-completion", "/"],
  ["/pricing", "/"],
  ["/decentralization", "/"],
  ["/debug", "/"],
];

/** The current litepaper is the static page. */
function ToStaticLitepaper() {
  useEffect(() => window.location.replace("/litepaper.html"), []);
  return null;
}

function AppRouter() {
  const [location] = useLocation();
  const retired = RETIRED.find(([p]) => location === p || location.startsWith(p + "/"));
  if (retired) return <Redirect to={retired[1]} replace />;
  return (
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
