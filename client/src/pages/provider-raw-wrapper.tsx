import { useRoute } from "wouter";
import ProviderRawPage from "./provider-raw";

export default function ProviderRawPageWrapper() {
  const [, params] = useRoute("/providers/:owner/raw");
  return <ProviderRawPage params={params} />;
}
