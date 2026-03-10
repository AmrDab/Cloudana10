import { ProviderRawData } from "@/components/providers/ProviderRawData";
import { Spinner } from "@/components/ui/spinner";

interface ProviderRawPageProps {
  params?: { owner?: string };
}

/** URL param is deviceId (unique provider key). */
export default function ProviderRawPage({ params }: ProviderRawPageProps) {
  const deviceIdParam = params?.owner ?? "";
  const deviceId = deviceIdParam ? decodeURIComponent(deviceIdParam) : "";

  if (!params || !deviceIdParam) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-10 w-10 text-primary" />
      </div>
    );
  }

  return <ProviderRawData deviceId={deviceId} />;
}
