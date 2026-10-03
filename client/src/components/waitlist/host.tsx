// One dialog per app for openWaitlist() requests from pages without an inline form.
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { WaitlistForm } from "./form";
import { registerHost, type WaitlistRequest } from "./store";

export function WaitlistHost() {
  const [req, setReq] = useState<WaitlistRequest | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(
    () =>
      registerHost((r) => {
        setReq(r);
        setOpen(true);
      }),
    [],
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto border-line-2 bg-panel sm:max-w-[520px] sm:rounded-xl">
        <DialogTitle className="font-head text-xl font-medium tracking-[-.02em]">Get in early.</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          One list for users, providers, verifiers and datacenters. We email when your branch opens.
        </DialogDescription>
        {/* Keyed so each request starts a fresh, correctly prefilled form. */}
        {req && <WaitlistForm key={req.n} compact defaultRole={req.role} defaultInterests={req.interests} />}
      </DialogContent>
    </Dialog>
  );
}
