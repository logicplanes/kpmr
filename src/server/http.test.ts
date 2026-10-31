import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandler, encodingFor, negotiate, providerFilter } from "./http.ts";
import { makeService } from "./test/helpers.ts";
import type { Service } from "./service.ts";

let base = "";
let close = () => undefined as unknown;
let service: Service;
const errors: unknown[] = [];

async function serve(svc: Service, webDir: string) {
  const handler = createHandler(svc, { webDir, onError: (e) => errors.push(e) });
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  return { url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`, close: () => server.close() };
}

beforeAll(async () => {
  const web = await mkdtemp(join(tmpdir(), "kpmr-web-"));
  await mkdir(join(web, "assets"));
  await writeFile(join(web, "index.html"), "<!doctype html><title>KPMR</title>");
  await writeFile(join(web, "assets/app-1.js"), "console.log(1)");
  await writeFile(join(web, "favicon.svg"), "<svg/>");
  ({ service } = await makeService());
  const notReady = await serve(service, web);
  const early = await fetch(`${notReady.url}/v1/catalogue`);
  expect(early.status).toBe(503);
  expect(early.headers.get("retry-after")).toBe("30");
  expect((await fetch(`${notReady.url}/v1/meta.json`)).status).toBe(503);
  notReady.close();
  await service.poll();
  const live = await serve(service, web);
  base = live.url;
  close = live.close;
});

afterAll(() => close());

describe("the catalogue endpoint", () => {
  it("answers signed, in Kaeso's media type, compressed and conditional", async () => {
    const r = await fetch(`${base}/v1/catalogue?providers=openai`, { headers: { accept: "application/vnd.kaeso.kpmr+json; version=1" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/vnd.kaeso.kpmr+json; version=1");
    expect(r.headers.get("kpmr-signature")).toMatch(/^keyid=test-key, ed25519=/);
    expect(r.headers.get("kpmr-revision")).toBe(service.meta()?.revision);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const doc = await r.json();
    expect(Object.keys(doc.providers)).toEqual(["openai"]);
    const etag = r.headers.get("etag") ?? "";
    const again = await fetch(`${base}/v1/catalogue?providers=openai`, { headers: { "if-none-match": etag } });
    expect(again.status).toBe(304);
    expect(again.headers.get("kpmr-signature")).toBeTruthy();
  });

  it("refuses format versions it doesn't serve", async () => {
    const r = await fetch(`${base}/v1/catalogue`, { headers: { accept: "application/vnd.kaeso.kpmr+json; version=2" } });
    expect(r.status).toBe(406);
    expect(await r.json()).toMatchObject({ supported: [1] });
  });

  it("sends gzip to a client that asks only for gzip", async () => {
    const res = await new Promise<{ encoding: string | undefined; body: Buffer }>((resolve) => {
      import("node:http").then(({ get }) =>
        get(`${base}/v1/catalogue`, { headers: { "accept-encoding": "gzip" } }, (r) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => resolve({ encoding: r.headers["content-encoding"], body: Buffer.concat(chunks) }));
        }),
      );
    });
    expect(res.encoding).toBe("gzip");
    expect(JSON.parse(gunzipSync(res.body).toString()).format).toBe(1);
  });
});

describe("the other endpoints", () => {
  it("serves meta, providers, models, changes and keys", async () => {
    expect((await (await fetch(`${base}/v1/meta.json`)).json()).catalogue).toMatchObject({ providers: 3, added: 2 });
    expect((await (await fetch(`${base}/v1/providers.json`)).json()).map((p: { id: string }) => p.id)).toContain("example");
    expect((await (await fetch(`${base}/v1/providers/anthropic.json`)).json()).kaeso).toBe(true);
    expect((await fetch(`${base}/v1/providers/nope.json`)).status).toBe(404);
    expect((await (await fetch(`${base}/v1/models/anthropic/claude-opus-5-5.json`)).json()).model.id).toBe("claude-opus-5-5");
    expect((await fetch(`${base}/v1/models/anthropic/nope.json`)).status).toBe(404);
    expect(await (await fetch(`${base}/v1/changes.json?limit=5`)).json()).toEqual([]);
    expect((await (await fetch(`${base}/v1/keys.json`)).json())[0]).toMatchObject({ id: "test-key", algorithm: "ed25519" });
    expect((await fetch(`${base}/v1/nothing`)).status).toBe(404);
    expect(await (await fetch(`${base}/healthz`)).json()).toMatchObject({ status: "ok", ready: true });
    expect(await (await fetch(`${base}/robots.txt`)).text()).toContain("Disallow: /v1/");
  });

  it("serves the pages, their assets and a strict policy", async () => {
    const page = await fetch(`${base}/de/providers/anthropic`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(await page.text()).toContain("<title>KPMR</title>");
    const asset = await fetch(`${base}/assets/app-1.js`);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/favicon.svg`)).headers.get("content-type")).toBe("image/svg+xml");
    expect((await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`)).status).not.toBe(500);
  });

  it("answers OPTIONS and refuses other methods", async () => {
    expect((await fetch(`${base}/v1/catalogue`, { method: "OPTIONS" })).status).toBe(204);
    expect((await fetch(`${base}/v1/catalogue`, { method: "POST" })).status).toBe(405);
    expect(errors).toEqual([]);
  });
});

describe("headers", () => {
  it("negotiates the format", () => {
    expect(negotiate(undefined).ok).toBe(true);
    expect(negotiate("*/*").ok).toBe(true);
    expect(negotiate("application/json").ok).toBe(true);
    expect(negotiate("application/vnd.kaeso.kpmr+json").ok).toBe(true);
    expect(negotiate("application/vnd.kaeso.kpmr+json; version=3, application/vnd.kaeso.kpmr+json; version=1").ok).toBe(true);
    expect(negotiate("text/html").ok).toBe(false);
    expect(negotiate("application/json; q=0").ok).toBe(false);
  });

  it("chooses an encoding and reads the provider list", () => {
    expect(encodingFor("gzip, br")).toBe("br");
    expect(encodingFor("gzip;q=1, br;q=0")).toBe("gzip");
    expect(encodingFor(undefined)).toBeNull();
    expect(providerFilter(null)).toBeNull();
    expect([...(providerFilter("openai, Bad Id ,anthropic") ?? [])]).toEqual(["openai", "anthropic"]);
  });
});
