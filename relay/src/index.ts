// cloudana-relay — nodes connect here; the gateway and the API reach a node's object through a script_name binding
// (docs/V4_RELAY_CONTRACT.md). The only public route is the ticketed WebSocket upgrade.
import { verifyTicket } from "../../shared/relay-ticket.js";
import type { Env } from "./node.js";

export { RelayNode } from "./node.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok", { headers: { "cache-control": "no-store" } });
    if (url.pathname !== "/connect") return new Response("not found", { status: 404 });
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
    if (!env.RELAY_TICKET_SECRET) return new Response("relay not configured", { status: 503 });

    const claims = await verifyTicket(env.RELAY_TICKET_SECRET, url.searchParams.get("ticket") ?? "").catch(() => null);
    if (!claims) return new Response("bad or expired ticket", { status: 401 });

    // Only the object of the node the ticket names, with the claims it needs for single use.
    const headers = new Headers(request.headers);
    headers.set("x-relay-node", claims.node);
    headers.set("x-relay-nonce", claims.nonce);
    headers.set("x-relay-exp", String(claims.expiresAt));
    const stub = env.RELAY.get(env.RELAY.idFromName(claims.node));
    return stub.fetch("https://relay/connect", { headers });
  },
};
