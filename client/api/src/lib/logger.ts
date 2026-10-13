/**
 * Colored console logger for API/orchestrator. Uses ANSI codes for terminal output.
 */
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgYellow: "\x1b[43m",
};

function format(tag: string, color: string, ...args: unknown[]): [string, ...unknown[]] {
  const prefix = `${color}${tag}${c.reset}`;
  return args.length === 0 ? [prefix] : [`${prefix}`, ...args];
}

/** Create a tagged logger (e.g. "[Orchestrator:event]"). */
export function createLogger(tag: string, opts?: { infoColor?: string; warnColor?: string; errorColor?: string }) {
  const infoColor = opts?.infoColor ?? c.cyan;
  const warnColor = opts?.warnColor ?? c.yellow;
  const errorColor = opts?.errorColor ?? c.red;
  return {
    info: (...args: unknown[]) => console.log(...format(tag, infoColor, ...args)),
    log: (...args: unknown[]) => console.log(...format(tag, c.blue, ...args)),
    success: (...args: unknown[]) => console.log(...format(tag, c.green, ...args)),
    warn: (...args: unknown[]) => console.warn(...format(tag, warnColor, ...args)),
    error: (...args: unknown[]) => console.error(...format(tag, errorColor, ...args)),
    dim: (...args: unknown[]) => console.log(...format(tag, c.dim, ...args)),
  };
}

/** Predefined loggers for recognizability. */
export const log = {
  api: createLogger("[API]", { infoColor: c.cyan }),
  orchestratorEvent: createLogger("[Orchestrator:event]", { infoColor: c.magenta }),
  orchestratorLoop: createLogger("[Orchestrator:loop]", { infoColor: c.blue }),
  placement: createLogger("[Placement]", { infoColor: c.cyan }),
  blockchain: createLogger("[Blockchain]", { infoColor: c.blue }),
  ipfs: createLogger("[IPFS]", { infoColor: c.green }),
  config: createLogger("[Config]", { infoColor: c.yellow }),
};
