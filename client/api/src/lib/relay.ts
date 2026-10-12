// The relay (docs/V4_RELAY_CONTRACT.md): the API reaches a node's RelayNode Durable Object for probes and status.
// worker.ts installs the Worker binding per request/cron; tests install a fake. Unset → relayed probes fail (safe:
// billing pauses rather than charging for something nobody checked).

export type RelayPath = "/proxy" | "/status" | "/kick";
export type RelayFetch = (node: string, path: RelayPath, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

let relay: RelayFetch | null = null;

export function setRelay(fetcher: RelayFetch | null): void {
  relay = fetcher;
}

export function getRelay(): RelayFetch | null {
  return relay;
}

/** A RelayFetch over the `RELAY` Durable Object namespace (script_name binding to cloudana-relay). */
export function relayFromBinding(ns: DurableObjectNamespace): RelayFetch {
  return (node, path, init = {}) =>
    ns.get(ns.idFromName(node)).fetch(`https://relay${path}`, {
      method: init.method ?? "GET",
      headers: { ...init.headers, "x-relay-node": node },
      signal: init.signal,
    });
}
