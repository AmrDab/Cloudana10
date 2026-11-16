// One byte stream on a node's relay socket (docs/V4_RELAY_CONTRACT.md "Byte streams"): the hub's side of an `open`.
// Pure logic over an injected `send`, like hub.ts, so it runs the same in the Durable Object and in Node tests.
import {
  LINGER_MS,
  OPEN_TIMEOUT_MS,
  TCP_IDLE_TIMEOUT_MS,
  WINDOW_BYTES,
  chunks,
  encodeData,
  type HubMessage,
  type NodeMessage,
} from "../../shared/relay-protocol.js";
import type { RelayError } from "./hub.js";

/** Bytes a byte stream holds for the node beyond what its window lets out (a WebSocket visitor cannot be paused). */
export const STREAM_BUFFER_BYTES = 2 * 1024 * 1024;

/**
 * A byte stream as its consumer (a bridge to a client WebSocket) sees it: write() / end() / close() / ack() toward
 * the node, and callbacks for what the node does. Bytes for the node wait in `out` until the window lets them go;
 * bytes from the node are handed to onData and acked when the consumer calls ack() (it decides when they count as
 * consumed).
 */
export class ByteStream {
  /** Bytes from the node (a copy); call ack(n) once they are consumed downstream. */
  onData: (data: Uint8Array) => void = () => {};
  /** The node consumed `n` of the bytes we sent (written to the app's socket). */
  onAck: (n: number) => void = () => {};
  /** The node's half ended: the app closed its side. */
  onEnd: () => void = () => {};
  /** The stream is gone: null after a clean end both ways, else why. Called once, and only after `opened` gave null. */
  onClose: (err: RelayError | null) => void = () => {};
  /** null once the node connected; else the reason (the stream is then already gone). */
  readonly opened: Promise<RelayError | null>;

  private resolveOpen!: (e: RelayError | null) => void;
  private settled = false;
  private isOpen = false;
  private closed = false;
  private out: Uint8Array[] = [];
  private queued = 0;
  /** Bytes sent to the node and not yet acked. */
  private unacked = 0;
  /** Bytes from the node handed to onData and not yet acked by the consumer. */
  private delivered = 0;
  private endWanted = false;
  private endSent = false;
  private nodeEnded = false;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly s: number,
    readonly dep: string,
    private hub: { send: (m: string | Uint8Array) => void; forget: () => void },
  ) {
    this.opened = new Promise((r) => (this.resolveOpen = r));
  }

  /** Queue bytes for the node. false: the stream is closed or ending, or the buffer overflowed (it is then closed). */
  write(data: Uint8Array): boolean {
    if (this.closed || this.endWanted) return false;
    for (const part of chunks(data)) this.out.push(part.slice());
    this.queued += data.byteLength;
    if (this.queued > STREAM_BUFFER_BYTES) {
      this.finish("too_large", true);
      return false;
    }
    this.flush();
    return true;
  }

  /** Our half is done: `end` goes out once every queued byte has. */
  end(): void {
    if (this.closed || this.endWanted) return;
    this.endWanted = true;
    this.flush();
  }

  /** Abort both ways (the client went away). */
  close(): void {
    this.finish(null, true);
  }

  /** The consumer took `n` of the node's bytes: the node may send that many more. */
  ack(n: number): void {
    const k = Math.min(Math.max(0, Math.floor(n)), this.delivered);
    if (this.closed || k === 0) return;
    this.delivered -= k;
    this.ctl({ t: "ack", s: this.s, n: k });
    this.touch();
  }

  // ── Called by the hub ─────────────────────────────────────────────────────────────────────────────────────

  /** @internal */
  settle(e: RelayError | null): void {
    if (this.settled) return;
    this.settled = true;
    if (this.openTimer) clearTimeout(this.openTimer);
    this.resolveOpen(e);
  }

  /** @internal */
  armOpenTimer(): void {
    this.openTimer = setTimeout(() => this.finish("timeout", true), OPEN_TIMEOUT_MS);
  }

  /** @internal A binary frame from the node. */
  fromNode(data: Uint8Array): void {
    if (this.closed || !this.isOpen || this.nodeEnded) return;
    this.delivered += data.byteLength;
    // The node must stay within the window like the hub does; past it, it is not speaking the protocol.
    if (this.delivered > WINDOW_BYTES) return this.finish("upstream", true);
    this.touch();
    this.onData(data.slice());
  }

  /** @internal A control message from the node for this stream. */
  control(m: NodeMessage): void {
    if (this.closed) return;
    switch (m.t) {
      case "opened":
        if (this.isOpen) return;
        this.isOpen = true;
        this.settle(null);
        this.touch();
        this.flush();
        return;
      case "ack":
        if (!this.isOpen) return;
        this.unacked = Math.max(0, this.unacked - m.n);
        this.touch();
        this.onAck(m.n);
        this.flush();
        return;
      case "end":
        if (!this.isOpen || this.nodeEnded) return;
        this.nodeEnded = true;
        this.touch();
        this.onEnd();
        if (this.endSent) this.finish(null, false);
        return;
      case "err":
        this.finish(m.code, false);
        return;
      default:
        return; // `res` belongs to HTTP streams
    }
  }

  /** @internal Done: cancel on the node unless it ended the stream itself; settle `opened` or call onClose, once. */
  finish(err: RelayError | null, tellNode: boolean): void {
    if (this.closed) return;
    this.closed = true;
    for (const t of [this.openTimer, this.idleTimer, this.lingerTimer]) if (t) clearTimeout(t);
    this.out = [];
    this.queued = 0;
    if (tellNode) {
      try {
        this.hub.send(JSON.stringify({ t: "cancel", s: this.s } satisfies HubMessage));
      } catch {
        /* socket gone */
      }
    }
    this.hub.forget();
    if (!this.settled) this.settle(err ?? "offline");
    else this.onClose(err);
  }

  private ctl(m: HubMessage) {
    try {
      this.hub.send(JSON.stringify(m));
    } catch {
      this.finish("offline", false);
    }
  }

  /** Send queued bytes as the window allows; then `end` once it is wanted and nothing is left. */
  private flush() {
    if (this.closed || !this.isOpen) return;
    try {
      while (this.out.length && this.unacked + this.out[0].byteLength <= WINDOW_BYTES) {
        const part = this.out.shift()!;
        this.queued -= part.byteLength;
        this.unacked += part.byteLength;
        this.hub.send(encodeData(this.s, part));
      }
    } catch {
      return this.finish("offline", false);
    }
    if (this.endWanted && !this.endSent && this.queued === 0) {
      this.endSent = true;
      this.ctl({ t: "end", s: this.s });
      if (this.closed) return;
      if (this.nodeEnded) return this.finish(null, false);
      this.lingerTimer = setTimeout(() => this.finish("timeout", true), LINGER_MS);
    }
    this.touch();
  }

  private touch() {
    if (this.closed) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.finish("timeout", true), TCP_IDLE_TIMEOUT_MS);
  }
}
