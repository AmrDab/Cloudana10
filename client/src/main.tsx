import { createRoot } from "react-dom/client";
import App from "./App-minimal";
import "./index.css";

// Suppress non-critical 403 errors from network image fetches (chain logos)
// These are handled gracefully by AppKit with fallbacks
if (typeof window !== "undefined") {
  const originalError = console.error;
  console.error = (...args: any[]) => {
    // Filter out 403 errors from network image fetches
    const errorString = args.join(" ");
    if (
      errorString.includes("HTTP status code: 403") &&
      (errorString.includes("fetchNetworkImage") || errorString.includes("FetchUtil.getBlob"))
    ) {
      // Suppress these non-critical errors - they just mean chain logos won't display
      return;
    }
    originalError.apply(console, args);
  };

  // Also handle unhandled promise rejections for the same errors
  window.addEventListener("unhandledrejection", (event) => {
    const error = event.reason;
    if (
      error?.message?.includes("HTTP status code: 403") &&
      (error?.stack?.includes("fetchNetworkImage") || error?.stack?.includes("FetchUtil.getBlob"))
    ) {
      event.preventDefault(); // Suppress the error
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
