import { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getAddressExplorerUrl } from "@/lib/transaction-utils";
import { cn } from "@/lib/utils";

interface AddressDisplayProps {
  address: string;
  label?: string;
  className?: string;
  showCopy?: boolean;
  showLink?: boolean;
  truncate?: boolean;
  truncateLength?: number;
}

export function AddressDisplay({
  address,
  label,
  className,
  showCopy = true,
  showLink = true,
  truncate = true,
  truncateLength = 10,
}: AddressDisplayProps) {
  const [copied, setCopied] = useState(false);

  const displayAddress = truncate
    ? `${address.slice(0, truncateLength)}...${address.slice(-8)}`
    : address;

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(address);
      } else {
        // Fallback for older browsers
        const textArea = document.createElement("textarea");
        textArea.value = address;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
      // Still show copied state briefly even if there's an error
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenExplorer = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(getAddressExplorerUrl(address), "_blank", "noopener,noreferrer");
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label && <span className="text-sm text-muted-foreground">{label}:</span>}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <code
              className="font-mono text-sm bg-muted px-2 py-1 rounded cursor-default select-all"
              title={address}
            >
              {displayAddress}
            </code>
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-mono text-xs">{address}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      {showCopy && (
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 transition-colors",
            copied && "bg-green-500/10 hover:bg-green-500/20"
          )}
          onClick={handleCopy}
          title={copied ? "Copied!" : "Copy address"}
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      )}
      
      {showLink && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleOpenExplorer}
          title="View on Base Sepolia explorer"
        >
          <ExternalLink className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

