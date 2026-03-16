// Modal to add funds: choose amount and payment method
// Handles both Stripe card and on-chain CLD crypto flows
import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Loader2, DollarSign } from "lucide-react";
import { PaymentMethodSelector, type PaymentMethod } from "./PaymentMethodSelector";
import { StripeCheckout } from "./StripeCheckout";
import { CryptoPayment } from "./CryptoPayment";
import { useAddFunds, useConversionRate } from "@/hooks/usePayments";
import type { CheckoutSession } from "@/lib/payments";
import { cn } from "@/lib/utils";

// ── Preset amounts ────────────────────────────────────────────────────────────

const PRESET_AMOUNTS = [10, 25, 50, 100] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

interface AddFundsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AddFundsModal({ open, onOpenChange, onSuccess }: AddFundsModalProps) {
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [selectedPreset, setSelectedPreset] = useState<number | null>(25);
  const [customAmount, setCustomAmount] = useState("");
  const [checkoutSession, setCheckoutSession] = useState<CheckoutSession | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);

  const { addFundsAsync, isPending: isCreatingSession, reset } = useAddFunds();
  const { rate } = useConversionRate();

  const amountUsd = selectedPreset ?? (parseFloat(customAmount) || 0);
  const cldEquivalent = rate ? amountUsd * rate.usdToCld : amountUsd * 10;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handlePresetClick = (amount: number) => {
    setSelectedPreset(amount);
    setCustomAmount("");
  };

  const handleCustomAmountChange = (value: string) => {
    setCustomAmount(value);
    setSelectedPreset(null);
  };

  const handleCardContinue = useCallback(async () => {
    if (amountUsd <= 0) return;
    try {
      const result = await addFundsAsync({ method: "card", amountUsd });
      if (result.session) {
        setCheckoutSession(result.session);
        setShowCheckout(true);
      }
    } catch {
      // Error is shown by the hook
    }
  }, [amountUsd, addFundsAsync]);

  const handleSuccess = useCallback(() => {
    onSuccess?.();
    handleClose();
  }, [onSuccess]);

  const handleClose = useCallback(() => {
    // Reset all state on close
    setShowCheckout(false);
    setCheckoutSession(null);
    setSelectedPreset(25);
    setCustomAmount("");
    setMethod("card");
    reset();
    onOpenChange(false);
  }, [onOpenChange, reset]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[460px] bg-background/95 backdrop-blur border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            Add Funds
          </DialogTitle>
          <DialogDescription>
            Top up your CLD credit balance to deploy workloads.
          </DialogDescription>
        </DialogHeader>

        {/* === Checkout step (card) === */}
        {showCheckout && method === "card" ? (
          <StripeCheckout
            session={checkoutSession}
            mode="redirect"
            amountUsd={amountUsd}
            onSuccess={handleSuccess}
            onError={() => {
              setShowCheckout(false);
            }}
            onCancel={() => {
              setShowCheckout(false);
              setCheckoutSession(null);
            }}
          />
        ) : (
          /* === Amount + method selection === */
          <div className="space-y-5">
            {/* Payment method toggle */}
            <PaymentMethodSelector
              selectedMethod={method}
              onMethodChange={setMethod}
              amountUsd={amountUsd}
              onAmountChange={(v) => {
                setSelectedPreset(null);
                setCustomAmount(v.toString());
              }}
              disabled={isCreatingSession}
            />

            {/* Amount picker (card flow only; crypto uses wallet balance directly) */}
            {method === "card" && (
              <>
                <Separator className="bg-white/10" />

                <div className="space-y-3">
                  <Label>Choose amount</Label>

                  {/* Preset buttons */}
                  <div className="grid grid-cols-4 gap-2">
                    {PRESET_AMOUNTS.map((amt) => (
                      <Button
                        key={amt}
                        variant="outline"
                        size="sm"
                        onClick={() => handlePresetClick(amt)}
                        className={cn(
                          "border-white/10",
                          selectedPreset === amt && "border-primary bg-primary/10 text-primary"
                        )}
                      >
                        ${amt}
                      </Button>
                    ))}
                  </div>

                  {/* Custom input */}
                  <div className="space-y-1">
                    <Label htmlFor="custom-amount" className="text-xs text-muted-foreground">
                      Custom amount
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                        $
                      </span>
                      <Input
                        id="custom-amount"
                        type="number"
                        min={1}
                        step={1}
                        value={customAmount}
                        onChange={(e) => handleCustomAmountChange(e.target.value)}
                        className="pl-7"
                        placeholder="Custom…"
                        disabled={isCreatingSession}
                      />
                    </div>
                  </div>

                  {/* Conversion preview */}
                  {amountUsd > 0 && (
                    <div className="rounded-md bg-muted/30 px-3 py-2 text-sm flex justify-between">
                      <span className="text-muted-foreground">You'll receive</span>
                      <span className="font-mono font-semibold text-primary">
                        {cldEquivalent.toFixed(2)} CLD credits
                      </span>
                    </div>
                  )}

                  {/* Conversion rate note */}
                  {rate && (
                    <p className="text-xs text-muted-foreground text-center">
                      Current rate: 1 USD = {rate.usdToCld} CLD
                    </p>
                  )}
                </div>

                <Button
                  className="w-full"
                  onClick={handleCardContinue}
                  disabled={amountUsd <= 0 || isCreatingSession}
                >
                  {isCreatingSession ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating session…
                    </>
                  ) : (
                    `Continue: $${amountUsd.toFixed(2)}`
                  )}
                </Button>
              </>
            )}

            {/* Crypto payment inline */}
            {method === "crypto" && (
              <>
                <Separator className="bg-white/10" />
                <CryptoPayment
                  onSuccess={handleSuccess}
                  onCancel={handleClose}
                />
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
