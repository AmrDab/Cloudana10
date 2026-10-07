// Add Funds — during the testnet there is nothing to buy: card payments are off and
// escrow deposits are credited by the Settlement `Deposited` watcher once the v2
// contracts are live. This modal explains that and points at test credits.
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Coins } from "lucide-react";

interface AddFundsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kept for callers; nothing is credited from this modal on the testnet. */
  onSuccess?: () => void;
}

export function AddFundsModal({ open, onOpenChange }: AddFundsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px] bg-background/95 backdrop-blur border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            Add Funds
          </DialogTitle>
          <DialogDescription>Card payments are off during testnet.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm text-muted-foreground">
          <p>
            Testnet CLD has no monetary value. Sign in on the console and claim 10 CLD of test credits per day
            (one claim per wallet and per IP address).
          </p>
          <p>
            Paying with crypto returns with the v2 Settlement contract: a <code>deposit()</code> into escrow is
            credited to your balance automatically.
          </p>
          <Button asChild className="w-full">
            <a href="/control/run">Test credits</a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
