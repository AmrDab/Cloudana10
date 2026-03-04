import { useRoute } from "wouter";
import { useEffect, useState } from "react";
import JobDetailPage from "./job-detail";
import { Spinner } from "@/components/ui/spinner";

export default function JobDetailPageWrapper() {
  const [match, params] = useRoute("/job/:id");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Wait for route to be ready
    if (match && params?.id) {
      setIsReady(true);
    } else if (!match) {
      setIsReady(false);
    }
  }, [match, params]);

  // Show loading while route params are being resolved
  if (!match || !params?.id) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-10 w-10 text-primary" />
      </div>
    );
  }

  return <JobDetailPage params={params} />;
}
