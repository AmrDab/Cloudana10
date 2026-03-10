/**
 * Retry utility with exponential backoff
 */
import { loggers } from "../logger.js";

export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Initial delay in ms */
  initialDelayMs: number;
  /** Maximum delay in ms */
  maxDelayMs: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Function to determine if error is retryable */
  shouldRetry?: (error: any) => boolean;
}

const defaultOptions: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Default retry predicate - retries on most errors except validation errors
 */
function defaultShouldRetry(error: any): boolean {
  // Don't retry on validation errors (4xx status codes)
  if (error?.response?.status >= 400 && error?.response?.status < 500) {
    return false;
  }
  
  // Retry on network errors, timeouts, 5xx errors
  return true;
}

/**
 * Execute function with retry logic and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  const shouldRetry = opts.shouldRetry || defaultShouldRetry;
  
  let lastError: any;
  let delay = opts.initialDelayMs;
  
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if we should retry
      if (attempt >= opts.maxAttempts || !shouldRetry(error)) {
        throw error;
      }
      
      // Log retry attempt
      const errorMsg = error instanceof Error ? error.message : String(error);
      loggers.server.warn(
        { attempt, maxAttempts: opts.maxAttempts, delay, error: errorMsg },
        `Retry attempt ${attempt}/${opts.maxAttempts} after error, waiting ${delay}ms...`
      );
      
      // Wait before retry
      await sleep(delay);
      
      // Increase delay with exponential backoff
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }
  
  // Should never reach here, but throw last error just in case
  throw lastError;
}

/**
 * Kubernetes-specific retry helper
 */
export async function withK8sRetry<T>(
  fn: () => Promise<T>,
  context: { operation: string; resource?: string }
): Promise<T> {
  return withRetry(fn, {
    maxAttempts: 3,
    initialDelayMs: 2000,
    maxDelayMs: 10000,
    shouldRetry: (error) => {
      // Don't retry on validation errors
      if (error?.message?.includes("Invalid") || error?.message?.includes("already exists")) {
        return false;
      }
      
      // Retry on connection errors, timeouts, conflicts
      return true;
    },
  }).catch((error) => {
    loggers.k8s.error(
      { operation: context.operation, resource: context.resource, error: error.message },
      `Failed after retries: ${context.operation}`
    );
    throw error;
  });
}
