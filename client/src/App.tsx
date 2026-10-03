import { Suspense, lazy } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Two bundles: the homepage (no wallet stack) and the console at /control.
const HomePage = lazy(() => import("@/pages/home"));
const LabPage = lazy(() => import("@/pages/lab"));
const PublicNotFound = lazy(() => import("@/pages/not-found-public"));
const ConsoleApp = lazy(() => import("./ConsoleApp"));

const Blank = () => <div className="min-h-dvh bg-bg" />;

function App() {
  const rawPath = typeof window !== "undefined" ? window.location.pathname : "/";
  const isHome = rawPath === "/" || rawPath === "";
  const isLab = rawPath === "/lab" || rawPath === "/lab/";
  const isConsole = rawPath === "/control" || rawPath.startsWith("/control/");
  return (
    <ErrorBoundary>
      <Suspense fallback={<Blank />}>{isHome ? <HomePage /> : isLab ? <LabPage /> : isConsole ? <ConsoleApp /> : <PublicNotFound />}</Suspense>
    </ErrorBoundary>
  );
}

export default App;
