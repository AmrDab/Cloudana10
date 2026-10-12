# cloudana-relay

Holds every node's one outbound WebSocket (docs/V4_RELAY_CONTRACT.md). One `RelayNode` Durable Object per node
(`idFromName(nodeAddress)`); the gateway and the API reach it through a `script_name` binding. Its only public route
is `GET /connect?ticket=…` (a single-use HMAC ticket from `POST /v1/nodes/relay/ticket`). Deploy it rarely: a deploy
drops every node socket (agents reconnect on their own).

- `src/hub.ts` — the protocol (streams, window, cancel, errors); pure, unit-tested in `test/hub.test.ts`.
- `src/node.ts` — the Durable Object glue (accept, single-use nonce, hibernation, kick, status, proxy).
- `src/index.ts` — the Worker: checks the ticket, hands the upgrade to the node's object.

## Tests

```bash
npm test                 # hub protocol (Node)
npx tsc --noEmit
```

In workerd with the real agent: put `RELAY_TICKET_SECRET=<any 32+ chars>` in `relay/.dev.vars`, run
`npx wrangler dev --port 8799 --ip 127.0.0.1` here, then `../node-agent/node_modules/.bin/tsx test/workerd.e2e.ts`.
The hub ↔ agent protocol test without Cloudflare is `node-agent/src/relay.e2e.selftest.ts` (part of `npm run selftest`).

## Deploy

```bash
npx wrangler deploy                         # relay.cloudana.io (custom domain)
npx wrangler secret put RELAY_TICKET_SECRET # same value as on cloudana-api; the owner sets it
```
Deploy this before any Worker that binds it (`cloudana-api`, `cloudana-gateway`).
