/** Small branded error pages (no tenant content, no external assets). */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function errorPage(status: number, title: string, message: string, id?: string, extraHeaders: Record<string, string> = {}): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · Cloudana</title>
<style>
:root{color-scheme:dark light;--bg:#0b0f14;--fg:#e6edf3;--muted:#8b98a5;--line:#1f2a36;--accent:#2dd4bf}
@media (prefers-color-scheme:light){:root{--bg:#f7f9fb;--fg:#0b0f14;--muted:#5b6774;--line:#dbe3ea}}
html,body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{min-height:100vh;display:grid;place-items:center;padding:24px 16px}
section{max-width:460px;width:100%;border:1px solid var(--line);border-radius:12px;padding:28px 24px}
.k{font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{font-size:22px;margin:10px 0 6px}p{margin:0;color:var(--muted)}code{font:12px ui-monospace,monospace;color:var(--muted);word-break:break-all}
footer{margin-top:20px;padding-top:14px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
a{color:var(--accent);text-decoration:none}
</style></head><body><main><section>
<div class="k">Cloudana · ${status}</div>
<h1>${esc(title)}</h1>
<p>${esc(message)}</p>
${id ? `<p style="margin-top:10px"><code>${esc(id)}</code></p>` : ""}
<footer>Sites on this network are run by independent nodes. <a href="https://cloudana.io" rel="noopener">cloudana.io</a></footer>
</section></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      ...extraHeaders,
    },
  });
}
