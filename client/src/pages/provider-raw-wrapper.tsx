import { useRoute } from "wouter";
import { useEffect, useState } from "react";
import ProviderRawPage from "./provider-raw";
import { Spinner } from "@/components/ui/spinner";

export default function ProviderRawPageWrapper() {
  const [match, params] = useRoute("/providers/:owner/raw");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Wait for route to be ready
    if (match && params?.owner) {
      setIsReady(true);
    } else if (!match) {
      setIsReady(false);
    }
  }, [match, params]);

  // Show loading while route params are being resolved
  if (!match || !params?.owner) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-10 w-10 text-primary" />
      </div>
    );
  }

  return <ProviderRawPage params={params} />;
}
