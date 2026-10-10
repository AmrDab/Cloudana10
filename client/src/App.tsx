import { Suspense, lazy } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Two bundles: the homepage (no wallet stack) and the console at /control.
const HomePage = lazy(() => import("@/pages/home"));
const LabPage = lazy(() => import("@/pages/lab"));
const PublicNotFound = lazy(() => import("@/pages/not-found-public"));
const ConsoleApp = lazy(() => import("./ConsoleApp"));

const Blank = () => <div className="min-h-dvh bg-bg" />;

/**
 * Two production sites, one build: the console lives on VITE_CONSOLE_ORIGIN (app.cloudana.io), the site on
 * cloudana.io. Console paths on the site host go to the console host; the console host's root opens the console.
 * Unset locally, so dev serves everything from one origin.
 */
function hostRedirect(): string | null {
  const consoleOrigin = import.meta.env.VITE_CONSOLE_ORIGIN as string | undefined;
  if (!consoleOrigin || typeof window === "undefined") return null;
  const { origin, pathname, search, hash } = window.location;
  const onConsoleHost = origin === consoleOrigin;
  const consolePath = pathname === "/control" || pathname.startsWith("/control/");
  if (!onConsoleHost && consolePath) return consoleOrigin + pathname + search + hash;
  if (onConsoleHost && (pathname === "/" || pathname === "")) return "/control" + search + hash;
  return null;
}

function App() {
  const to = hostRedirect();
  if (to) {
    window.location.replace(to);
    return <Blank />;
  }
  const rawPath = typeof window !== "undefined" ? window.location.pathname : "/";
  const isHome = rawPath === "/" || rawPath === "";
  const isLab = rawPath === "/lab" || rawPath === "/lab/";
  const isConsole = rawPath === "/control" || rawPath.startsWith("/control/");
  // The console wears the homepage's light "Paper" theme (index.css); set before first paint, no dark flash.
  if (typeof document !== "undefined") document.documentElement.classList.toggle("theme-paper", isConsole);
  return (
    <ErrorBoundary>
      <Suspense fallback={<Blank />}>{isHome ? <HomePage /> : isLab ? <LabPage /> : isConsole ? <ConsoleApp /> : <PublicNotFound />}</Suspense>
    </ErrorBoundary>
  );
}

export default App;
