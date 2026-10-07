# cloudana-gateway

Cloudflare Worker that serves hosted Cloudana sites at `https://{deploymentId}.sites.cloudana.io/…`.

```
visitor → *.sites.cloudana.io (this Worker)
            │  GET {API_URL}/v1/deployments/{id}/route   (public; cached 30 s in caches.default)
            │  → { state, endpoint }
            └─ GET/HEAD http://<node>:<port>/path         (10 s timeout) → response + security headers
```

What it does on every response from a node:

- drops `Set-Cookie`; forwards only `Content-Type`, `Cache-Control`, `ETag`, `Last-Modified`, `Location`, range and encoding headers;
- adds `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`;
- for `text/html` adds `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups`, so one tenant's scripts run in an opaque origin and cannot read another tenant's cookies or storage;
- rewrites a `Location` that points at the node's own address back to the public host;
- proxies only `http(s)` endpoints on public addresses (private ranges, localhost, `.internal`/`.local` are refused with 502);
- shows a small Cloudana page instead of the site when it is not running: 404 (unknown id, stopped, failed) or 503 with `Retry-After` (queued, assigned, unreachable, node timeout, API down).

Only `GET` and `HEAD` are proxied; anything else gets 405. Request cookies and `Authorization` are never forwarded.

## Configuration (`wrangler.toml` `[vars]`)

| Var | Default | Meaning |
|---|---|---|
| `API_URL` | `https://api.cloudana.io` | Cloudana API origin that answers `/v1/deployments/{id}/route` |
| `SITES_DOMAIN` | `sites.cloudana.io` | Sites live at `*.{SITES_DOMAIN}`; must match the API's `SITES_DOMAIN` so console URLs resolve here |

## Deploy (owner steps)

1. **DNS** (Cloudflare dashboard, zone `cloudana.io`): add a *proxied* (orange cloud) wildcard record so requests reach Cloudflare's edge:
   `*.sites` → `AAAA 100::` (any proxied target works; the Worker route answers, the target is never contacted).
   TLS: the Universal certificate covers `*.cloudana.io` only, which does **not** include `*.sites.cloudana.io` (one level deeper). Enable **Total TLS** or order an Advanced Certificate with `*.sites.cloudana.io` on the zone before going live.
2. **Route**: in `wrangler.toml` uncomment
   ```toml
   routes = [{ pattern = "*.sites.cloudana.io/*", zone_name = "cloudana.io" }]
   ```
3. `cd gateway && npm install && npx wrangler login && npm run deploy`.
4. **API**: set `SITES_DOMAIN` (defaults to `sites.cloudana.io`) and make sure `GET /v1/deployments/{id}/route` is reachable without a JWT (`client/api/src/middleware/security.ts`).
5. Smoke test: open a running static deployment's `url` from the console. A stopped one must show the Cloudana 404 page; `curl -I` must show `x-content-type-options: nosniff` and, for HTML, the sandbox CSP.

Local run: `npm run dev` then `curl -H "Host: <id>.sites.cloudana.io" http://127.0.0.1:8787/` (set `API_URL` in `.dev.vars` to a local API if needed).

## Tests

`npm test` — vitest with a mocked `fetch` and an in-memory stand-in for `caches.default` (`test/gateway.test.ts`): host parsing, private-range rejection, header policy, HEAD, redirect rewrite, route caching, every error page.
