import { useRoute } from "wouter";
import JobDetailPage from "./job-detail";

export default function JobDetailPageWrapper() {
  const [, params] = useRoute("/job/:id");
  return <JobDetailPage params={params} />;
}
