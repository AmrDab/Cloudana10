/**
 * Colored console logger for frontend. Uses %c for dev; no-op for log/info/debug/warn in production.
 */
const isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV === true;

const styles = {
  reset: "",
  tag: "font-weight: bold; padding: 0 4px; border-radius: 3px;",
  orchestrator: "color: #a855f7; background: #f3e8ff;",
  api: "color: #0ea5e9; background: #e0f2fe;",
  ipfs: "color: #059669; background: #d1fae5;",
  contract: "color: #2563eb; background: #dbeafe;",
  wallet: "color: #c2410c; background: #ffedd5;",
  templates: "color: #7c3aed; background: #ede9fe;",
  deploy: "color: #0d9488; background: #ccfbf1;",
  info: "color: #0369a1;",
  success: "color: #15803d;",
  warn: "color: #a16207;",
  error: "color: #b91c1c; font-weight: bold;",
};

function noop(_?: unknown, ..._args: unknown[]): void {}

function devLog(style: string, tag: string, ...args: unknown[]) {
  if (args.length === 0) {
    console.log(`%c${tag}`, `${styles.tag}${style}`);
    return;
  }
  const first = typeof args[0] === "string" ? `${tag} ${args[0]}` : tag;
  const rest = typeof args[0] === "string" ? args.slice(1) : args;
  console.log(`%c${first}`, `${styles.tag}${style}`, ...rest);
}

function devWarn(style: string, tag: string, ...args: unknown[]) {
  console.warn(`%c${tag}`, `${styles.tag}${styles.warn}${style}`, ...args);
}

function devError(style: string, tag: string, ...args: unknown[]) {
  console.error(`%c${tag}`, `${styles.tag}${styles.error}${style}`, ...args);
}

/** Create a tagged logger; in production log/info/debug/warn/dim are no-ops; error still runs. */
export function createLogger(tag: string, styleKey: keyof typeof styles = "info") {
  const style = styles[styleKey] ?? styles.info;
  return {
    log: isDev ? (...args: unknown[]) => devLog(style, tag, ...args) : noop,
    info: isDev ? (...args: unknown[]) => devLog(style, tag, ...args) : noop,
    debug: isDev ? (...args: unknown[]) => devLog(style, tag, ...args) : noop,
    dim: isDev ? (...args: unknown[]) => devLog(style, tag, ...args) : noop,
    warn: isDev ? (...args: unknown[]) => devWarn(style, tag, ...args) : noop,
    error: (...args: unknown[]) => devError(style, tag, ...args),
    success: isDev ? (...args: unknown[]) => devLog(styles.success, tag, ...args) : noop,
  };
}

export const devLoggers = {
  orchestrator: createLogger("Orchestrator", "orchestrator"),
  api: createLogger("API", "api"),
  ipfs: createLogger("IPFS", "ipfs"),
  contract: createLogger("Contract", "contract"),
  wallet: createLogger("Wallet", "wallet"),
  templates: createLogger("Templates", "templates"),
  deploy: createLogger("Deploy", "deploy"),
  userJobs: createLogger("useUserJobs", "contract"),
  provider: createLogger("Provider", "deploy"),
};
