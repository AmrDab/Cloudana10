import { setupV1Db } from "./helpers/v1-db.js";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { buildApp } from "../src/app.js";

const KEY = "k".repeat(32);
let app: ReturnType<typeof buildApp>;
let ipSeq = 0;

function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `10.8.0.${ipSeq++ % 250}`);
  return app.request(path, { ...init, headers });
}

type T = { id: string; kind?: string; curated?: boolean; image?: string | null; files?: { path: string; contentBase64: string }[]; logoUrl: string | null };
const all = (data: { title: string; templates: T[] }[]) => data.flatMap((c) => c.templates);

beforeAll(async () => {
  await setupV1Db({ INTERNAL_API_KEY: KEY });
  app = buildApp({ runtime: "node" });
});
afterEach(() => vi.unstubAllGlobals());

describe("templates", () => {
  it("serves ≥ 40 curated templates (static starters first) when the store is empty", async () => {
    const body = await (await call("/v1/templates")).json();
    const list = all(body.data);
    expect(list.length).toBeGreaterThanOrEqual(40);
    expect(body.data[0].title).toBe("Static sites");
    const starters = list.filter((t) => t.kind === "static");
    expect(starters.map((t) => t.id)).toEqual(expect.arrayContaining(["static-blank-site", "static-landing-page", "static-docs-site"]));
    for (const s of starters) {
      const html = Buffer.from(s.files!.find((f) => f.path === "index.html")!.contentBase64, "base64").toString();
      expect(html).toContain("#07090D");
      expect(html).toContain("Space Grotesk");
    }
    for (const id of ["nginx", "postgresql", "redis", "minio", "ollama", "vllm", "jupyter", "grafana", "uptime-kuma", "ghost", "wordpress", "gitea", "n8n", "matrix-synapse", "mastodon"]) {
      expect(list.find((t) => t.id === id), id).toMatchObject({ kind: "container", curated: true, image: expect.any(String) });
    }
    expect(new Set(list.map((t) => t.id)).size).toBe(list.length);
  });

  it("GET /templates/{id} resolves curated ids", async () => {
    const res = await call("/v1/templates/static-blank-site");
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ id: "static-blank-site", kind: "static" });
    expect((await (await call("/v1/templates/nginx")).json()).data).toMatchObject({ image: "nginx:alpine", ports: [80], logoUrl: "https://cdn.simpleicons.org/nginx" });
    expect((await call("/v1/templates/nope")).status).toBe(404);
  });

  it("refresh requires X-Internal-Key", async () => {
    expect((await call("/v1/admin/templates/refresh", { method: "POST" })).status).toBe(401);
    expect((await call("/v1/admin/templates/refresh", { method: "POST", headers: { "X-Internal-Key": "wrong" } })).status).toBe(401);
  });

  it("refresh merges awesome-akash behind the curated list and stores it", async () => {
    const files: Record<string, string> = {
      "README.md": "### AI - LLM\n\n- [Foo Chat](foo-chat)\n",
      "foo-chat/README.md": "# Foo Chat\n\nA chat app for testing.\n",
      "foo-chat/deploy.yaml": "---\nversion: \"2.0\"\nservices:\n  web:\n    image: foo/chat:1.2\n",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const m = /awesome-akash\/master\/(.+)$/.exec(String(url));
        return m && files[m[1]] ? new Response(files[m[1]]) : new Response("not found", { status: 404 });
      }),
    );
    const res = await call("/v1/admin/templates/refresh", { method: "POST", headers: { "X-Internal-Key": KEY } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "success", imported: 1 });
    expect(body.curated).toBeGreaterThanOrEqual(40);
    expect(body.templates).toBe(body.curated + 1);

    const list = all((await (await call("/v1/templates")).json()).data);
    expect(list[0].id).toBe("static-blank-site");
    const foo = list.find((t) => t.id === "akash-network-awesome-akash-foo-chat");
    expect(foo).toMatchObject({ kind: "container", curated: false, image: "foo/chat:1.2" });
    // stored copies keep their run fields
    expect((await (await call("/v1/templates/static-landing-page")).json()).data.files[0].path).toBe("index.html");
  });

  it("refresh still stores the curated list when GitHub is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const body = await (await call("/v1/admin/templates/refresh", { method: "POST", headers: { "X-Internal-Key": KEY } })).json();
    expect(body).toMatchObject({ status: "success", imported: 0 });
    expect(all((await (await call("/v1/templates")).json()).data).length).toBe(body.curated);
  });
});
