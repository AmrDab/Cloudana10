// Crypto payment component — approve + transfer CLD tokens to escrow
// Uses existing wagmi hooks from lib/contracts.ts
import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { formatEther, parseEther, type Address } from "viem";
import {
  useCLDTokenBalance,
  useCLDTokenAllowance,
  useApproveCLDToken,
  REWARD_CONTRACT_ADDRESS,
  CLD_TOKEN_ADDRESS,
} from "@/lib/contracts";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { CLDTokenAbi, CONTRACT_ADDRESSES } from "@shared/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertCircle, Coins, ExternalLink } from "lucide-react";
import { useAddFunds } from "@/hooks/usePayments";
import { useConversionRate } from "@/hooks/usePayments";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CryptoPaymentProps {
  /** The escrow / recipient contract address */
  escrowAddress?: Address;
  onSuccess?: (txHash: string, amountCld: number) => void;
  onCancel?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CryptoPayment({
  escrowAddress = REWARD_CONTRACT_ADDRESS as Address,
  onSuccess,
  onCancel,
}: CryptoPaymentProps) {
  const { address, isConnected } = useAccount();
  const [amountInput, setAmountInput] = useState("");
  const [step, setStep] = useState<"input" | "approve" | "transfer" | "recording" | "done">("input");
  const [error, setError] = useState<string | null>(null);
  const [depositTxHash, setDepositTxHash] = useState<string | null>(null);

  const { rate } = useConversionRate();
  const { addFundsAsync, isPending: isRecording } = useAddFunds();

  // Balance & allowance
  const { data: rawBalance } = useCLDTokenBalance(address);
  const { data: rawAllowance } = useCLDTokenAllowance(address, escrowAddress);

  const cldBalance = rawBalance ? parseFloat(formatEther(rawBalance as bigint)) : 0;
  const currentAllowance = rawAllowance ? parseFloat(formatEther(rawAllowance as bigint)) : 0;
  const amountCld = parseFloat(amountInput) || 0;
  const needsApproval = amountCld > 0 && currentAllowance < amountCld;

  // Approve hook
  const {
    approve,
    isPending: isApproving,
    isSuccess: isApproved,
    error: approveError,
    reset: resetApprove,
  } = useApproveCLDToken();

  // Transfer hook (ERC-20 transfer to escrow)
  const {
    writeContract: writeTransfer,
    data: transferHash,
    isPending: isTransferWritePending,
    error: transferWriteError,
    reset: resetTransfer,
  } = useWriteContract();

  const {
    isLoading: isTransferConfirming,
    isSuccess: isTransferConfirmed,
    error: transferConfirmError,
  } = useWaitForTransactionReceipt({
    hash: transferHash,
    query: { enabled: !!transferHash },
  });

  const isTransferring = isTransferWritePending || isTransferConfirming;

  // ── Side effects ──────────────────────────────────────────────────────────

  // Approval done → move to transfer
  useEffect(() => {
    if (isApproved && step === "approve") {
      setStep("transfer");
    }
  }, [isApproved, step]);

  // Transfer confirmed → record with backend
  useEffect(() => {
    if (isTransferConfirmed && transferHash && step === "transfer") {
      setStep("recording");
      setDepositTxHash(transferHash);

      addFundsAsync({ method: "crypto", txHash: transferHash, amountCld })
        .then(() => {
          setStep("done");
          onSuccess?.(transferHash, amountCld);
        })
        .catch((err: Error) => {
          // Backend recording failed — show error but tx is confirmed on-chain
          setError(`Deposit recorded on-chain but credit sync failed: ${err.message}. Please contact support with tx hash: ${transferHash}`);
          setStep("done");
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTransferConfirmed, transferHash, step]);

  // Handle errors
  useEffect(() => {
    if (approveError) setError(approveError.message);
    if (transferWriteError) setError(transferWriteError.message);
    if (transferConfirmError) setError(transferConfirmError.message);
  }, [approveError, transferWriteError, transferConfirmError]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleApprove = () => {
    setError(null);
    resetApprove();
    setStep("approve");
    approve(escrowAddress, amountInput);
  };

  const handleTransfer = () => {
    setError(null);
    resetTransfer();
    writeTransfer({
      address: CLD_TOKEN_ADDRESS,
      abi: CLDTokenAbi,
      functionName: "transfer",
      args: [escrowAddress, parseEther(amountInput)],
    });
  };

  const handleReset = () => {
    setStep("input");
    setAmountInput("");
    setError(null);
    setDepositTxHash(null);
    resetApprove();
    resetTransfer();
  };

  // ── Render: not connected ─────────────────────────────────────────────────

  if (!isConnected) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Connect your wallet to pay with CLD tokens.</AlertDescription>
      </Alert>
    );
  }

  // ── Render: done ──────────────────────────────────────────────────────────

  if (step === "done" && !error) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 className="h-12 w-12 text-green-500" />
        <p className="text-lg font-semibold">Deposit complete!</p>
        <p className="text-sm text-muted-foreground">
          {amountCld.toFixed(4)} CLD have been added to your account.
        </p>
        {depositTxHash && (
          <a
            href={`https://sepolia.basescan.org/tx/${depositTxHash}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-primary underline underline-offset-2"
          >
            View transaction <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <Button variant="outline" onClick={handleReset}>
          Make another deposit
        </Button>
      </div>
    );
  }

  // ── Render: main form ─────────────────────────────────────────────────────

  const usdValue = rate ? amountCld * rate.cldToUsd : amountCld * 0.1;

  return (
    <div className="space-y-4">
      {/* Balance pill */}
      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-muted/20 px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Coins className="h-4 w-4" />
          Wallet balance
        </span>
        <Badge variant="secondary" className="font-mono">
          {cldBalance.toFixed(4)} CLD
        </Badge>
      </div>

      {/* Amount input */}
      <div className="space-y-1.5">
        <Label htmlFor="cld-amount">Amount (CLD)</Label>
        <Input
          id="cld-amount"
          type="number"
          min={0.0001}
          step={0.0001}
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          placeholder="0.0000"
          disabled={step !== "input"}
        />
        {amountCld > 0 && (
          <p className="text-xs text-muted-foreground">
            ≈ ${usdValue.toFixed(2)} USD
          </p>
        )}
        {amountCld > cldBalance && (
          <p className="text-xs text-destructive">Insufficient balance</p>
        )}
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs break-all">{error}</AlertDescription>
        </Alert>
      )}

      {/* Step indicator */}
      <StepIndicator currentStep={step} needsApproval={needsApproval} />

      {/* Action buttons */}
      <div className="space-y-2">
        {step === "input" && (
          <>
            {needsApproval ? (
              <Button
                className="w-full"
                onClick={handleApprove}
                disabled={amountCld <= 0 || amountCld > cldBalance}
              >
                Approve {amountCld > 0 ? `${amountCld.toFixed(4)} CLD` : ""}
              </Button>
            ) : (
              <Button
                className="w-full"
                onClick={handleTransfer}
                disabled={amountCld <= 0 || amountCld > cldBalance}
              >
                Transfer {amountCld > 0 ? `${amountCld.toFixed(4)} CLD` : ""}
              </Button>
            )}
          </>
        )}

        {step === "approve" && (
          <Button className="w-full" disabled>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {isApproving ? "Approving… (confirm in wallet)" : "Waiting for approval…"}
          </Button>
        )}

        {step === "transfer" && (
          <Button className="w-full" onClick={handleTransfer} disabled={isTransferring}>
            {isTransferring ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isTransferWritePending ? "Confirm in wallet…" : "Confirming…"}
              </>
            ) : (
              `Send ${amountCld.toFixed(4)} CLD`
            )}
          </Button>
        )}

        {step === "recording" && (
          <Button className="w-full" disabled>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Recording deposit…
          </Button>
        )}

        {onCancel && step !== "recording" && (
          <Button variant="ghost" className="w-full" onClick={onCancel} disabled={isApproving || isTransferring}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Step Indicator ────────────────────────────────────────────────────────────

function StepIndicator({
  currentStep,
  needsApproval,
}: {
  currentStep: string;
  needsApproval: boolean;
}) {
  const steps = needsApproval
    ? ["Approve", "Transfer", "Confirm"]
    : ["Transfer", "Confirm"];

  const stepMap: Record<string, number> = needsApproval
    ? { input: 0, approve: 0, transfer: 1, recording: 2, done: 2 }
    : { input: 0, transfer: 0, recording: 1, done: 1 };

  const activeIdx = stepMap[currentStep] ?? 0;

  if (currentStep === "input") return null;

  return (
    <div className="flex items-center gap-2">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2 flex-1">
          <div
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
              i < activeIdx
                ? "bg-green-500 text-white"
                : i === activeIdx
                ? "bg-primary text-primary-foreground"
                : "border border-white/20 text-muted-foreground"
            }`}
          >
            {i < activeIdx ? "✓" : i + 1}
          </div>
          <span className={`text-xs ${i === activeIdx ? "text-foreground" : "text-muted-foreground"}`}>
            {label}
          </span>
          {i < steps.length - 1 && (
            <div className={`h-px flex-1 ${i < activeIdx ? "bg-green-500" : "bg-white/10"}`} />
          )}
        </div>
      ))}
    </div>
  );
}
