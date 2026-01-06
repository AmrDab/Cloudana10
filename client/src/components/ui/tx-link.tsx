import { ExternalLink, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getTxExplorerUrl, formatTxHash } from "@/lib/transaction-utils";
import { cn } from "@/lib/utils";

interface TxLinkProps {
  hash: string | `0x${string}`;
  label?: string;
  className?: string;
  variant?: "inline" | "alert" | "button";
}

export function TxLink({ hash, label = "Transaction successful", className, variant = "alert" }: TxLinkProps) {
  const explorerUrl = getTxExplorerUrl(hash);
  const formattedHash = formatTxHash(hash);

  const handleClick = () => {
    window.open(explorerUrl, "_blank", "noopener,noreferrer");
  };

  if (variant === "inline") {
    return (
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex items-center gap-1 text-sm text-primary hover:underline font-mono",
          className
        )}
      >
        {formattedHash}
        <ExternalLink className="h-3 w-3" />
      </a>
    );
  }

  if (variant === "button") {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        className={cn("gap-2 font-mono", className)}
      >
        {formattedHash}
        <ExternalLink className="h-3 w-3" />
      </Button>
    );
  }

  // Alert variant (default)
  return (
    <Alert className={cn("bg-green-500/10 border-green-500/20", className)}>
      <Check className="h-4 w-4 text-green-500" />
      <AlertDescription className="flex items-center justify-between">
        <span className="text-sm text-green-500">{label}</span>
        <button
          onClick={handleClick}
          className="inline-flex items-center gap-1 text-sm text-green-400 hover:text-green-300 hover:underline font-mono"
        >
          {formattedHash}
          <ExternalLink className="h-3 w-3" />
        </button>
      </AlertDescription>
    </Alert>
  );
}

