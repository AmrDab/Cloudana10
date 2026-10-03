// Live network numbers from GET /v1/network, polled every 15 s and shared by every component
// on the page (one request, many readers). Offline → `data` keeps null and `offline` is true;
// callers render "—", never stale numbers pretending to be live.
import { useSyncExternalStore } from "react";
import { api } from "@/lib/cld";

export type NetworkStats = {
  nodesOnline: number;
  nodesBound: number;
  jobsQueued: number;
  jobsDone: number;
  certificates: number;
  mintedUcld: number;
  burnedUcld: number;
  verifiersToday: number;
  epoch: number;
  priceUcldPerMmac: number;
};

type State = { data: NetworkStats | null; offline: boolean; updatedAt: number | null };

const POLL_MS = 15_000;
let state: State = { data: null, offline: false, updatedAt: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function poll() {
  if (typeof document !== "undefined" && document.hidden) return;
  try {
    const data = await api<NetworkStats & { status: string }>("/network");
    state = { data, offline: false, updatedAt: Date.now() };
  } catch {
    state = { data: null, offline: true, updatedAt: state.updatedAt };
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!timer) {
    poll();
    timer = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", poll);
    }
  };
}

export function useNetwork(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
