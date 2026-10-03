/**
 * Static starter sites (kind "static"): a default `files` payload a user can deploy as-is.
 * Brand: #07090D background, Space Grotesk headlines, teal accent. ASCII only (btoa-safe).
 */

const HEAD = (title: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root { --bg:#07090D; --panel:#0E1218; --line:#1C232D; --text:#E8EDF2; --muted:#8A96A3; --accent:#2DD4BF; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--text); font:16px/1.6 Inter, system-ui, sans-serif; padding:0 16px; }
  main { max-width:880px; margin:0 auto; padding:72px 0; }
  h1, h2 { font-family:"Space Grotesk", sans-serif; letter-spacing:-0.02em; line-height:1.1; }
  h1 { font-size:clamp(2.2rem, 6vw, 3.6rem); margin-bottom:16px; }
  h2 { font-size:1.4rem; margin:40px 0 12px; }
  p { color:var(--muted); max-width:60ch; }
  a { color:var(--accent); }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:20px; }
  .grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); margin-top:32px; }
  .btn { display:inline-block; margin-top:28px; padding:12px 20px; border-radius:8px; background:var(--accent); color:#04110F; font-weight:500; text-decoration:none; }
  footer { margin-top:72px; color:var(--muted); font-size:14px; }
</style>
</head>
<body>
<main>
`;
const FOOT = `<footer>Served by a Cloudana node.</footer>
</main>
</body>
</html>
`;

const PAGES: { id: string; name: string; summary: string; html: string }[] = [
  {
    id: "static-blank-site",
    name: "Blank site",
    summary: "A single index.html, ready to edit. The fastest way to put a page online.",
    html: `${HEAD("Hello from Cloudana")}<h1>Hello, world.</h1>
<p>This page is hosted by a node on the Cloudana network. Replace index.html with your own and redeploy.</p>
${FOOT}`,
  },
  {
    id: "static-landing-page",
    name: "Landing page",
    summary: "Hero, three feature cards and a call to action. Edit the copy and ship.",
    html: `${HEAD("Your product")}<h1>Your product, in one sentence.</h1>
<p>Say what it does and who it is for. Keep it short; the cards below carry the detail.</p>
<a class="btn" href="#start">Get started</a>
<div class="grid">
  <div class="card"><h2>Fast</h2><p>Static files, served close to your visitors.</p></div>
  <div class="card"><h2>Simple</h2><p>One folder. No build step required.</p></div>
  <div class="card"><h2>Yours</h2><p>Swap this text for what makes your product different.</p></div>
</div>
<h2 id="start">Get started</h2>
<p>Link to your sign-up form, docs or store here.</p>
${FOOT}`,
  },
  {
    id: "static-docs-site",
    name: "Docs site",
    summary: "A one-page documentation layout with sections and code blocks.",
    html: `${HEAD("Docs")}<h1>Documentation</h1>
<p>Everything you need to start. Each section below is a heading you can link to.</p>
<h2 id="install">Install</h2>
<div class="card"><code>npm install your-package</code></div>
<h2 id="usage">Usage</h2>
<p>Describe the main call, its inputs and what it returns.</p>
<h2 id="faq">FAQ</h2>
<p>Answer the three questions people ask most.</p>
${FOOT}`,
  },
  {
    id: "static-link-page",
    name: "Link page",
    summary: "A personal link-in-bio page: name, one line about you, and your links.",
    html: `${HEAD("Links")}<h1>Your Name</h1>
<p>One line about what you do.</p>
<div class="grid">
  <a class="card" href="https://example.com">Website</a>
  <a class="card" href="https://example.com">Writing</a>
  <a class="card" href="https://example.com">Contact</a>
</div>
${FOOT}`,
  },
];

export interface StaticStarter {
  id: string;
  name: string;
  summary: string;
  files: { path: string; contentBase64: string }[];
}

export const STATIC_STARTERS: StaticStarter[] = PAGES.map((p) => ({
  id: p.id,
  name: p.name,
  summary: p.summary,
  files: [{ path: "index.html", contentBase64: btoa(p.html) }],
}));
