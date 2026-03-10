// Toggle between card and crypto payment methods
// Shows CLD balance preview for crypto, USD→CLD conversion for card
import { useState } from "react";
import { CreditCard, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatEther } from "viem";
import { useCLDTokenBalance } from "@/lib/contracts";
import { useConversionRate } from "@/hooks/usePayments";
import { useAccount } from "wagmi";

export type PaymentMethod = "card" | "crypto";

interface PaymentMethodSelectorProps {
  selectedMethod: PaymentMethod;
  onMethodChange: (method: PaymentMethod) => void;
  amountUsd: number;
  onAmountChange: (amount: number) => void;
  disabled?: boolean;
}

export function PaymentMethodSelector({
  selectedMethod,
  onMethodChange,
  amountUsd,
  onAmountChange,
  disabled,
}: PaymentMethodSelectorProps) {
  const { address } = useAccount();
  const { data: walletCldBalance } = useCLDTokenBalance(address);
  const { rate } = useConversionRate();

  const walletCld = walletCldBalance ? parseFloat(formatEther(walletCldBalance as bigint)) : 0;
  const cldPreview = rate ? amountUsd * rate.usdToCld : amountUsd * 10;

  return (
    <div className="space-y-4">
      {/* Method Toggle */}
      <div className="grid grid-cols-2 gap-2">
        <MethodCard
          active={selectedMethod === "card"}
          onClick={() => onMethodChange("card")}
          disabled={disabled}
          icon={<CreditCard className="h-5 w-5" />}
          label="Pay with Card"
          sub="Instant · Stripe secured"
        />
        <MethodCard
          active={selectedMethod === "crypto"}
          onClick={() => onMethodChange("crypto")}
          disabled={disabled}
          icon={<Coins className="h-5 w-5" />}
          label="Pay with Crypto"
          sub={`${walletCld.toFixed(2)} CLD available`}
        />
      </div>

      {/* Amount Input (card only — for crypto the amount comes from the wallet tx) */}
      {selectedMethod === "card" && (
        <div className="space-y-2">
          <Label htmlFor="pay-amount">Amount (USD)</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
              $
            </span>
            <Input
              id="pay-amount"
              type="number"
              min={1}
              step={0.01}
              value={amountUsd || ""}
              onChange={(e) => onAmountChange(parseFloat(e.target.value) || 0)}
              className="pl-7"
              placeholder="0.00"
              disabled={disabled}
            />
          </div>
          {amountUsd > 0 && rate && (
            <p className="text-xs text-muted-foreground">
              ≈ {cldPreview.toFixed(2)} CLD credits
              <span className="ml-2 text-muted-foreground/60">
                (rate: 1 USD = {rate.usdToCld} CLD)
              </span>
            </p>
          )}
        </div>
      )}

      {/* Crypto: show wallet balance info */}
      {selectedMethod === "crypto" && (
        <div className="rounded-lg border border-white/10 bg-muted/20 p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Wallet CLD balance</span>
            <span className="font-mono font-medium">{walletCld.toFixed(4)} CLD</span>
          </div>
          {rate && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">USD equivalent</span>
              <span className="font-mono text-muted-foreground">
                ≈ ${(walletCld * rate.cldToUsd).toFixed(2)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Internal MethodCard ───────────────────────────────────────────────────────

function MethodCard({
  active,
  onClick,
  disabled,
  icon,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all",
        "hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        active
          ? "border-primary bg-primary/10"
          : "border-white/10 bg-card/40 hover:bg-card/60",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <span className={cn("text-primary", !active && "text-muted-foreground")}>{icon}</span>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </button>
  );
}
