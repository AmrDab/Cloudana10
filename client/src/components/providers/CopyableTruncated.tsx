import { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const DEFAULT_TRUNCATE_LEN = 32;
const IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";

/**
 * Check if a string is a valid IPFS CID (v0 or v1)
 */
function isIpfsCid(str: string): boolean {
  if (!str) return false;
  const trimmed = str.trim();
  // CIDv0: Qm followed by 44 base58 characters
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(trimmed)) return true;
  // CIDv1: base32 (starts with b), 59 characters
  if (/^b[a-z2-7]{58}$/.test(trimmed)) return true;
  return false;
}

/**
 * Convert IPFS CID or URL to a browsable IPFS gateway URL
 */
function resolveIpfsUrl(value: string): string {
  if (!value) return value;
  const trimmed = value.trim();
  
  // Already a full URL, return as-is
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  
  // IPFS CID, convert to gateway URL
  if (isIpfsCid(trimmed)) {
    return `${IPFS_GATEWAY}${trimmed}`;
  }
  
  // Assume it's a CID even if validation failed
  return `${IPFS_GATEWAY}${trimmed}`;
}

interface CopyableTruncatedProps {
  value: string;
  truncateLength?: number;
  className?: string;
  /** If true, show an external link button (opens value as URL). */
  link?: boolean;
}

export function CopyableTruncated({
  value,
  truncateLength = DEFAULT_TRUNCATE_LEN,
  className,
  link = false,
}: CopyableTruncatedProps) {
  const [copied, setCopied] = useState(false);
  const isUrl = link || (value.startsWith("http://") || value.startsWith("https://"));
  const isCid = isIpfsCid(value);
  const display =
    value.length <= truncateLength + 8
      ? value
      : `${value.slice(0, truncateLength)}…${value.slice(-8)}`;

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const el = document.createElement("textarea");
        el.value = value;
        el.style.position = "fixed";
        el.style.left = "-9999px";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenLink = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isUrl) {
      // Convert IPFS CID to gateway URL if needed
      const url = resolveIpfsUrl(value);
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className={cn("flex items-center gap-1 min-w-0", className)}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-mono text-sm truncate block min-w-0" title={value}>
              {isCid && <span className="text-muted-foreground mr-1">ipfs://</span>}
              {display}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[320px]">
            <p className="font-mono text-xs break-all">
              {isCid && <span className="text-muted-foreground">ipfs://</span>}
              {value}
            </p>
            {isCid && (
              <p className="text-xs text-muted-foreground mt-1">
                ↳ Opens via IPFS gateway
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={handleCopy}
        title={copied ? "Copied!" : "Copy"}
      >
        {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
      </Button>
      {isUrl && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={handleOpenLink}
          title={isCid ? "Open IPFS content in browser" : "Open link"}
        >
          <ExternalLink className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
