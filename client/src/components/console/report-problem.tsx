import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LifeBuoy, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/cld";
import { ucldToUsd, usd, usePrices } from "@/lib/prices";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { btn } from "@/components/console/primitives";
import { errText } from "@/components/console/actions";

interface Outcome {
  id: string;
  probeOk: boolean | null;
  forgivenUcld: number;
  message: string;
}

/**
 * "Report a problem" (POST /v1/deployments/{id}/report): the network checks it now; a failed check leaves the time
 * since its last passing check uncharged. An endpoint checks every live replica.
 */
export function ReportProblem({ id, name, replicas, className = btn.ghost }: { id: string; name: string; replicas?: number; className?: string }) {
  const qc = useQueryClient();
  const { usdPerCld } = usePrices();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function report() {
    setBusy(true);
    try {
      const { results } = await api<{ results: Outcome[] }>(`/deployments/${id}/report`, {
        method: "POST",
        auth: true,
        body: note.trim() ? { note: note.trim() } : {},
        signal: AbortSignal.timeout(30_000),
      });
      const forgiven = results.reduce((s, r) => s + r.forgivenUcld, 0);
      const failed = results.filter((r) => r.probeOk === false).length;
      const off = forgiven > 0 ? ` · ${usd(ucldToUsd(forgiven, usdPerCld))} not charged` : "";
      if (results.length === 1) {
        const [r] = results;
        const say = r.message.charAt(0).toUpperCase() + r.message.slice(1);
        if (r.probeOk === true && forgiven === 0) toast(say, { description: name });
        else toast.success(say, { description: `${name}${off}` });
      } else if (forgiven > 0 || failed > 0) {
        toast.success(`${failed} of ${results.length} replicas failed the check`, { description: `${name}${forgiven > 0 ? off : " · already paused"}` });
      } else if (results.every((r) => r.probeOk === true)) {
        toast(`Every replica answered the network's check`, { description: "If it's still broken for you, check your app's logs." });
      } else {
        toast("The check couldn't reach every node", { description: "The network keeps checking every minute." });
      }
      setNote("");
      qc.invalidateQueries({ queryKey: ["cld", "deployments"] });
      qc.invalidateQueries({ queryKey: ["cld", "deployment", id] });
    } catch (e) {
      // The daily cap's message says what the limit is; the generic one would say "in a minute".
      toast.error("Couldn't check it", { description: e instanceof ApiError && e.code === "rate_limited" ? e.message : errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type="button" className={className} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <LifeBuoy />} Report a problem
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="border-line-2 bg-panel">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-head text-text">Something wrong with {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The network checks {replicas && replicas > 1 ? `each of its ${replicas} replicas` : "it"} right now, the same way it does
            every minute. If the check fails, the time since it last passed one isn't charged, and the failure counts like any
            missed check. If it passes, nothing changes. Up to 5 reports a day.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <textarea
          aria-label="What's wrong (optional)"
          placeholder="What's wrong? (optional)"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          className="h-20 w-full resize-none rounded-md border border-line-2 bg-bg-2 p-3 text-[13px] leading-5 text-text placeholder:text-faint"
        />
        <AlertDialogFooter>
          <AlertDialogCancel className={btn.ghost}>Cancel</AlertDialogCancel>
          <AlertDialogAction className={btn.primary} onClick={report}>Check now</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
