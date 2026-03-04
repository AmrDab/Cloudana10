// Utility functions for handling transaction errors and formatting messages

/**
 * Parse transaction error and return user-friendly message
 */
export function parseTransactionError(error: any): string {
  if (!error) return "Unknown error occurred";
  
  const message = error.message || error.toString();
  
  // User rejected transaction
  if (
    message.includes("User rejected") ||
    message.includes("User denied") ||
    message.includes("user rejected") ||
    message.includes("UserRejectedRequestError")
  ) {
    return "Transaction was rejected in your wallet";
  }
  
  // Insufficient funds
  if (
    message.includes("insufficient funds") ||
    message.includes("InsufficientFundsError")
  ) {
    return "Insufficient funds to complete transaction";
  }
  
  // Gas estimation failed
  if (
    message.includes("gas required exceeds") ||
    message.includes("out of gas")
  ) {
    return "Transaction would fail. Please check your inputs and try again";
  }
  
  // Contract-specific errors
  if (message.includes("InsufficientBalance")) {
    return "Insufficient token balance for this operation";
  }
  
  if (message.includes("InsufficientAllowance")) {
    return "Token allowance is insufficient. Please approve tokens first";
  }
  
  if (message.includes("ProviderAlreadyExists")) {
    return "This provider is already registered";
  }
  
  if (message.includes("MaxProvidersReached")) {
    return "Maximum number of providers (10) reached for your wallet";
  }
  
  if (message.includes("ProviderNotFound")) {
    return "Provider not found";
  }
  
  if (message.includes("NotProviderOwner")) {
    return "You are not the owner of this provider";
  }
  
  if (message.includes("InvalidPubKeyHash")) {
    return "Invalid public key hash";
  }
  
  if (message.includes("InvalidIPFSCID")) {
    return "Invalid IPFS CID";
  }
  
  if (message.includes("JobNotFound")) {
    return "Job not found";
  }
  
  if (message.includes("NotJobCreator")) {
    return "You are not the creator of this job";
  }
  
  if (message.includes("JobNotActive")) {
    return "Job is not active";
  }
  
  if (message.includes("NoCreditsToWithdraw")) {
    return "No credits available to withdraw";
  }
  
  // Network errors
  if (message.includes("network") || message.includes("Network")) {
    return "Network error. Please check your connection and try again";
  }
  
  // Internal JSON-RPC error (usually means transaction would revert)
  if (message.includes("Internal JSON-RPC error")) {
    // Try to extract revert reason if available
    try {
      const jsonMatch = message.match(/\{.*\}/);
      if (jsonMatch) {
        const errorData = JSON.parse(jsonMatch[0]);
        if (errorData.message) {
          return `Transaction would fail: ${errorData.message}`;
        }
      }
    } catch (e) {
      // Failed to parse, use generic message
    }
    return "Transaction would fail. Please check your balance, allowance, and try again";
  }
  
  // Default: return cleaned error message
  // Remove technical prefixes
  const cleanMessage = message
    .replace(/^Error: /, "")
    .replace(/^Error:\s*/, "")
    .replace(/\n.*$/, "") // Remove everything after first newline
    .trim();
  
  // If message is too long, truncate it
  if (cleanMessage.length > 200) {
    return cleanMessage.substring(0, 200) + "...";
  }
  
  return cleanMessage || "Transaction failed";
}

/**
 * Format transaction hash for display
 */
export function formatTxHash(hash: string | `0x${string}`, length: number = 10): string {
  if (!hash) return "";
  return `${hash.slice(0, length)}...${hash.slice(-8)}`;
}

/**
 * Get Base Sepolia block explorer URL for transaction
 */
export function getTxExplorerUrl(hash: string | `0x${string}`): string {
  return `https://sepolia.basescan.org/tx/${hash}`;
}

/**
 * Get Base Sepolia block explorer URL for address
 */
export function getAddressExplorerUrl(address: string | `0x${string}`): string {
  return `https://sepolia.basescan.org/address/${address}`;
}

