import { useRoute } from "wouter";
import ProviderDetailPage from "./provider-detail";

export default function ProviderDetailPageWrapper() {
  const [, params] = useRoute("/providers/:owner");
  return <ProviderDetailPage params={params} />;
}
