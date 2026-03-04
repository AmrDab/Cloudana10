/**
 * Circular log buffer for provider node.
 * Stores recent logs in memory for owner viewing.
 */

export interface LogEntry {
  timestamp: number;
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  category: string;
  message: string;
  data?: unknown;
}

const MAX_LOG_ENTRIES = 5000; // Keep last 5000 log entries
const logBuffer: LogEntry[] = [];

/**
 * Add a log entry to the buffer.
 */
export function addLogEntry(entry: LogEntry): void {
  logBuffer.push(entry);
  
  // Keep buffer size limited (circular buffer)
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.shift(); // Remove oldest
  }
}

/**
 * Get recent log entries with optional filtering.
 */
export function getLogEntries(options: {
  limit?: number;
  sinceTimestamp?: number;
  level?: LogEntry["level"];
  category?: string;
} = {}): LogEntry[] {
  const { limit = 500, sinceTimestamp, level, category } = options;
  
  let filtered = logBuffer;
  
  // Filter by timestamp
  if (sinceTimestamp !== undefined) {
    filtered = filtered.filter((log) => log.timestamp >= sinceTimestamp);
  }
  
  // Filter by level
  if (level) {
    filtered = filtered.filter((log) => log.level === level);
  }
  
  // Filter by category
  if (category) {
    filtered = filtered.filter((log) => log.category === category);
  }
  
  // Return most recent entries up to limit
  return filtered.slice(-limit);
}

/**
 * Get log statistics.
 */
export function getLogStats(): {
  totalEntries: number;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
  levelCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
} {
  const levelCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  
  for (const log of logBuffer) {
    levelCounts[log.level] = (levelCounts[log.level] || 0) + 1;
    categoryCounts[log.category] = (categoryCounts[log.category] || 0) + 1;
  }
  
  return {
    totalEntries: logBuffer.length,
    oldestTimestamp: logBuffer.length > 0 ? logBuffer[0].timestamp : null,
    newestTimestamp: logBuffer.length > 0 ? logBuffer[logBuffer.length - 1].timestamp : null,
    levelCounts,
    categoryCounts,
  };
}

/**
 * Clear all log entries.
 */
export function clearLogBuffer(): void {
  logBuffer.length = 0;
}
