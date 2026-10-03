// The default index.html for "Paste HTML" deployments — a complete, working page with no external requests.
export const STATIC_STARTER = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hello from Cloudana</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #07090d; color: #e6e9ef;
           font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
    main { max-width: 34rem; padding: 2rem; }
    h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 .75rem; font-weight: 600; }
    p { color: #9aa3b2; margin: 0 0 1rem; }
    code { font: 14px ui-monospace, SFMono-Regular, Menlo, monospace; color: #3dd6c0; }
  </style>
</head>
<body>
  <main>
    <h1>It works.</h1>
    <p>This page is served by a node on the Cloudana network. The orchestrator placed it there and probes it every minute.</p>
    <p>Edit <code>index.html</code> and deploy again to change it.</p>
  </main>
</body>
</html>
`;
