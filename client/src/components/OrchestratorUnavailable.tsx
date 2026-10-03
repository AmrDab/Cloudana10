import { ServerOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/** Compact inline notice shown instead of empty data when an orchestrator route is unavailable. */
export function OrchestratorUnavailable({ detail, className }: { detail?: string; className?: string }) {
  return (
    <Alert className={cn("border-amber-500/40 bg-amber-500/5 py-2", className)}>
      <ServerOff className="h-4 w-4 !text-amber-500" />
      <AlertTitle className="text-amber-500">Orchestrator unavailable</AlertTitle>
      <AlertDescription className="text-xs text-muted-foreground">
        {detail ?? "This feature needs the Cloudana orchestrator, which isn't reachable right now."}
      </AlertDescription>
    </Alert>
  );
}
