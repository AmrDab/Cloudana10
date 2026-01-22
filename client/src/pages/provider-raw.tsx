import { ProviderRawData } from "@/components/providers/ProviderRawData";
import { Spinner } from "@/components/ui/spinner";

interface ProviderRawPageProps {
  params?: { owner?: string };
}

export default function ProviderRawPage({ params }: ProviderRawPageProps) {
  const owner = params?.owner ?? "";

  // Handle case when route params are not yet available (e.g., on refresh)
  // This is a safety check - wrapper should handle this, but keep as fallback
  if (!params || !owner || owner === "") {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-10 w-10 text-primary" />
      </div>
    );
  }
  
  return <ProviderRawData owner={owner} />;
}
