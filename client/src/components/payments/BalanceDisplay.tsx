// Shows the user's CLD credit balance with an Add Funds button
// and a compact recent transactions preview
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Wallet,
  Plus,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import { AddFundsModal } from "./AddFundsModal";
import { useBalance, useTransactionHistory } from "@/hooks/usePayments";
import { useAccount } from "wagmi";
import type { Transaction } from "@/lib/payments";
import { cn } from "@/lib/utils";

// ── Component ─────────────────────────────────────────────────────────────────

interface BalanceDisplayProps {
  /** Compact single-line variant for sidebar / header usage */
  compact?: boolean;
  className?: string;
}

export function BalanceDisplay({ compact = false, className }: BalanceDisplayProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const { isConnected } = useAccount();
  const { balance, isLoading, refetch } = useBalance();
  const { transactions, isLoading: txLoading } = useTransactionHistory(5);

  const handleSuccess = () => {
    refetch();
  };

  // ── Compact variant (for nav / header) ────────────────────────────────────

  if (compact) {
    return (
      <>
        <div className={cn("flex items-center gap-2", className)}>
          <span className="text-sm text-muted-foreground">Balance:</span>
          {isLoading ? (
            <Skeleton className="h-4 w-20" />
          ) : (
            <span className="font-mono text-sm font-semibold">
              {isConnected ? `${(balance?.cldCredits ?? 0).toFixed(2)} CLD` : "—"}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setModalOpen(true)}
            disabled={!isConnected}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Funds
          </Button>
        </div>

        <AddFundsModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          onSuccess={handleSuccess}
        />
      </>
    );
  }

  // ── Full card variant ─────────────────────────────────────────────────────

  return (
    <>
      <Card className={cn("border-white/5 bg-card/50", className)}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4 text-primary" />
              Credit Balance
            </CardTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => refetch()}
              disabled={isLoading}
              title="Refresh balance"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Balance figures */}
          <div className="space-y-1">
            {isLoading ? (
              <>
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-4 w-24" />
              </>
            ) : !isConnected ? (
              <div className="text-muted-foreground text-sm py-2">
                Connect wallet to view balance
              </div>
            ) : (
              <>
                <div className="text-3xl font-bold font-mono">
                  {(balance?.cldCredits ?? 0).toFixed(2)}{" "}
                  <span className="text-lg text-muted-foreground">CLD</span>
                </div>
                <div className="text-sm text-muted-foreground font-mono">
                  ≈ ${(balance?.usdEquivalent ?? 0).toFixed(2)} USD
                </div>
              </>
            )}
          </div>

          {/* Add Funds button */}
          <Button
            className="w-full"
            onClick={() => setModalOpen(true)}
            disabled={!isConnected}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Funds
          </Button>

          {/* Recent transactions */}
          {isConnected && (
            <>
              <Separator className="bg-white/10" />
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Recent Activity
                </p>
                {txLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-8 w-full" />
                    ))}
                  </div>
                ) : transactions.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2 text-center">
                    No transactions yet
                  </p>
                ) : (
                  <div className="space-y-1">
                    {transactions.map((tx) => (
                      <TransactionRow key={tx.id} tx={tx} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AddFundsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSuccess={handleSuccess}
      />
    </>
  );
}

// ── TransactionRow ────────────────────────────────────────────────────────────

function TransactionRow({ tx }: { tx: Transaction }) {
  const isCredit = tx.type === "card_deposit" || tx.type === "crypto_deposit" || tx.type === "refund";
  const sign = isCredit ? "+" : "−";

  const label: Record<Transaction["type"], string> = {
    card_deposit: "Card deposit",
    crypto_deposit: "Crypto deposit",
    deployment_charge: "Deployment",
    refund: "Refund",
  };

  const statusColor: Record<Transaction["status"], string> = {
    pending: "bg-yellow-500/20 text-yellow-400",
    completed: "bg-green-500/20 text-green-400",
    failed: "bg-red-500/20 text-red-400",
  };

  const date = new Date(tx.createdAt);
  const relativeTime = formatRelativeTime(date);

  return (
    <div className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-white/5 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn("shrink-0 rounded-full p-1", isCredit ? "bg-green-500/10" : "bg-red-500/10")}>
          {isCredit ? (
            <ArrowDownLeft className="h-3 w-3 text-green-400" />
          ) : (
            <ArrowUpRight className="h-3 w-3 text-red-400" />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium truncate">{label[tx.type]}</p>
          <p className="text-xs text-muted-foreground">{relativeTime}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-2">
        <span
          className={cn(
            "font-mono text-xs font-semibold",
            isCredit ? "text-green-400" : "text-red-400"
          )}
        >
          {sign}{tx.amountCld.toFixed(2)} CLD
        </span>
        {tx.status !== "completed" && (
          <Badge variant="outline" className={cn("text-[10px] px-1 py-0", statusColor[tx.status])}>
            {tx.status}
          </Badge>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
