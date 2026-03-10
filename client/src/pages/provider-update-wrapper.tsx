import { useRoute } from "wouter";
import { useEffect, useState } from "react";
import ProviderUpdatePage from "./provider-update";
import { Spinner } from "@/components/ui/spinner";

export default function ProviderUpdatePageWrapper() {
  const [match, params] = useRoute("/providers/:owner/edit");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (match && params?.owner) {
      setIsReady(true);
    } else if (!match) {
      setIsReady(false);
    }
  }, [match, params]);

  if (!match || !params?.owner) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-10 w-10 text-primary" />
      </div>
    );
  }

  return <ProviderUpdatePage params={params} />;
}
