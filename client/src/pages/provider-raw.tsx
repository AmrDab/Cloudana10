import { useRoute } from "wouter";
import { ProviderRawData } from "@/components/providers/ProviderRawData";

export default function ProviderRawPage() {
  const [, params] = useRoute("/providers/:owner/raw");
  const owner = params?.owner ?? "";

  if (!owner) return null;
  return <ProviderRawData owner={owner} />;
}
