import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, relative, sep } from "node:path";
import { FORMAT, MEDIA_TYPE } from "../shared/catalogue.ts";
import { LICENSES_TXT } from "./legal/licenses.ts";
import type { Body, Service } from "./service.ts";
import { headFor, llms, renderHead, resolvePage, safeDecode, sitemap } from "./site.ts";

export const API_CACHE = "public, max-age=60, stale-while-revalidate=600, stale-if-error=86400";
export const IMMUTABLE = "public, max-age=31536000, immutable";
export const PAGE_CACHE = "no-cache";
export const SITE_CACHE = "public, max-age=3600";
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";
export const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
export const SUPPORTED_FORMATS = [FORMAT];
export const MAX_PROVIDERS = 64;

const JSON_TYPE = "application/json; charset=utf-8";
const TEXT_TYPE = "text/plain; charset=utf-8";
const HTML_TYPE = "text/html; charset=utf-8";
const CATALOGUE_TYPE = `${MEDIA_TYPE}; version=${FORMAT}`;
const METHODS = "GET, HEAD, OPTIONS";
const ENCODED: Record<string, string> = { br: "-br", gzip: "-gz" };

const COMMON: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

const API_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "ETag, KPMR-Revision, KPMR-Signature, Retry-After",
  "cross-origin-resource-policy": "cross-origin",
  "content-security-policy": API_CSP,
};

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": JSON_TYPE,
  ".txt": TEXT_TYPE,
  ".webmanifest": "application/manifest+json",
};

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

const tagOf = (bytes: Buffer) => `"${createHash("sha256").update(bytes).digest("base64url").slice(0, 27)}"`;

export function matches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const bare = etag.replace(/"$/, "");
  return header.split(",").some((c) => {
    const tag = c.trim().replace(/^W\//, "");
    return tag === "*" || tag === etag || Object.values(ENCODED).some((suffix) => tag === `${bare}${suffix}"`);
  });
}

export function negotiate(accept: string | undefined): { ok: boolean } {
  if (!accept) return { ok: true };
  const ranges = accept.split(",").map((part) => {
    const [type = "", ...params] = part.split(";").map((s) => s.trim().toLowerCase());
    const param = (name: string) =>
      params
        .find((p) => p.startsWith(`${name}=`))
        ?.slice(name.length + 1)
        .replace(/^"(.*)"$/, "$1");
    return { type, version: param("version"), q: Number(param("q") ?? 1) };
  });
  for (const r of ranges.filter((r) => r.q > 0)) {
    if (r.type === MEDIA_TYPE) {
      if (r.version === undefined || SUPPORTED_FORMATS.includes(Number(r.version))) return { ok: true };
    } else if (r.type === "*/*" || r.type === "application/*" || r.type === "application/json") return { ok: true };
  }
  return { ok: false };
}

export function encodingFor(header: string | undefined): "br" | "gzip" | null {
  const accepted = new Set(
    (header ?? "")
      .split(",")
      .map((p) => p.trim().split(";"))
      .filter(([, q]) => !q || Number(q.trim().replace(/^q=/, "")) > 0)
      .map(([name]) => (name ?? "").toLowerCase()),
  );
  if (accepted.has("br")) return "br";
  if (accepted.has("gzip")) return "gzip";
  return null;
}

const json = (status: number, value: unknown, headers: Record<string, string> = {}): Reply => ({
  status,
  headers: { "content-type": JSON_TYPE, ...API_HEADERS, ...headers },
  body: Buffer.from(JSON.stringify(value)),
});

const error = (status: number, message: string, headers: Record<string, string> = {}, extra: Record<string, unknown> = {}): Reply =>
  json(status, { error: message, ...extra }, { "cache-control": "no-store", ...headers });

function cached(req: IncomingMessage, type: string, body: Buffer, cacheControl: string, headers: Record<string, string> = {}): Reply {
  const etag = tagOf(body);
  const all = { ...headers, etag, "cache-control": cacheControl };
  if (matches(req.headers["if-none-match"], etag)) return { status: 304, headers: all, body: Buffer.alloc(0) };
  return { status: 200, headers: { "content-type": type, ...all }, body };
}

const cachedJson = (req: IncomingMessage, value: unknown) => cached(req, JSON_TYPE, Buffer.from(JSON.stringify(value)), API_CACHE, API_HEADERS);

function catalogueReply(req: IncomingMessage, body: Body, revision: string): Reply {
  const encoding = encodingFor(req.headers["accept-encoding"] as string | undefined);
  const encoded = encoding === "br" ? body.br : encoding === "gzip" ? body.gzip : undefined;
  const etag = encoded && encoding ? body.etag.replace(/"$/, `${ENCODED[encoding]}"`) : body.etag;
  const headers: Record<string, string> = {
    ...API_HEADERS,
    etag,
    "kpmr-revision": revision,
    "kpmr-signature": body.signature,
    "cache-control": API_CACHE,
    vary: "Accept, Accept-Encoding",
  };
  if (matches(req.headers["if-none-match"], body.etag)) return { status: 304, headers, body: Buffer.alloc(0) };
  return {
    status: 200,
    headers: { "content-type": CATALOGUE_TYPE, ...headers, ...(encoded && encoding ? { "content-encoding": encoding } : {}) },
    body: encoded ?? body.bytes,
  };
}

export type Filter = { ok: true; ids: Set<string> | null } | { ok: false; message: string };

export function providerFilter(value: string | null): Filter {
  if (value === null) return { ok: true, ids: null };
  const ids = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return { ok: false, message: "providers is empty; leave it out for every provider, or name at least one." };
  if (ids.length > MAX_PROVIDERS) return { ok: false, message: `providers names more than ${MAX_PROVIDERS} providers; leave it out for every provider.` };
  const bad = ids.find((id) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id));
  if (bad !== undefined) return { ok: false, message: `${JSON.stringify(bad)} is not a provider id.` };
  return { ok: true, ids: new Set(ids) };
}

export interface HandlerOptions {
  webDir: string;
  origin: string;
  onError: (error: unknown) => void;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)])));
  return nested.flat();
}

export async function createHandler(service: Service, options: HandlerOptions): Promise<(req: IncomingMessage, res: ServerResponse) => Promise<void>> {
  const { origin } = options;
  const files = new Map<string, Buffer>();
  for (const file of await listFiles(options.webDir)) {
    const path = `/${relative(options.webDir, file).split(sep).join("/")}`;
    if (path.endsWith(".map")) continue;
    files.set(path, await readFile(file));
  }
  const shell = files.get("/index.html")?.toString("utf8") ?? null;
  files.delete("/index.html");
  const generated = new Map<string, { revision: string; body: Buffer }>();
  const perRevision = (name: string, make: () => string): Buffer => {
    const revision = service.meta()?.revision ?? "";
    const known = generated.get(name);
    if (known?.revision === revision) return known.body;
    const body = Buffer.from(make());
    generated.set(name, { revision, body });
    return body;
  };

  const notReady = () => error(503, "The catalogue is not ready yet; try again shortly.", { "retry-after": String(service.retryAfterSeconds()) });

  const page = (req: IncomingMessage, url: URL): Reply => {
    const resolved = resolvePage(url.pathname, url.search, service);
    if (resolved.kind === "redirect") return { status: 301, headers: { location: resolved.location, "cache-control": SITE_CACHE }, body: Buffer.alloc(0) };
    if (!shell)
      return {
        status: 503,
        headers: { "content-type": TEXT_TYPE, "cache-control": "no-store" },
        body: Buffer.from("The registry's pages are missing from this build.\n"),
      };
    const body = Buffer.from(renderHead(shell, origin, resolved, headFor(resolved, service)));
    const reply = cached(req, HTML_TYPE, body, PAGE_CACHE, {
      "content-security-policy": PAGE_CSP,
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-site",
    });
    return resolved.status === 404 ? { ...reply, status: 404, body } : reply;
  };

  const route = async (req: IncomingMessage, url: URL): Promise<Reply> => {
    const path = url.pathname;
    if (path === "/healthz") return json(200, service.health(), { "cache-control": "no-store" });
    if (path === "/robots.txt")
      return cached(req, TEXT_TYPE, Buffer.from(`User-agent: *\nAllow: /\nDisallow: /v1/\n\nSitemap: ${origin}/sitemap.xml\n`), SITE_CACHE);
    if (path === "/licenses.txt") return cached(req, TEXT_TYPE, Buffer.from(LICENSES_TXT), SITE_CACHE, { "access-control-allow-origin": "*" });
    if (path === "/llms.txt")
      return cached(
        req,
        "text/markdown; charset=utf-8",
        perRevision("llms", () => llms(origin, service)),
        SITE_CACHE,
      );
    if (path === "/sitemap.xml") {
      if (!service.ready()) return notReady();
      return cached(
        req,
        "application/xml; charset=utf-8",
        perRevision("sitemap", () => sitemap(origin, service)),
        SITE_CACHE,
      );
    }
    if (path === "/v1/keys.json") return cachedJson(req, service.keys());

    if (path === "/v1/catalogue") {
      if (!negotiate(req.headers.accept).ok)
        return error(406, `KPMR serves the catalogue as ${MEDIA_TYPE} in format ${SUPPORTED_FORMATS.join(", ")}.`, {}, { supported: SUPPORTED_FORMATS });
      const filter = providerFilter(url.searchParams.get("providers"));
      if (!filter.ok) return error(400, filter.message);
      const body = service.catalogueBody(filter.ids);
      const meta = service.meta();
      if (!body || !meta) return notReady();
      return catalogueReply(req, await body, meta.revision);
    }

    if (path.startsWith("/v1/")) {
      if (!service.ready()) return notReady();
      if (path === "/v1/meta.json") return cachedJson(req, service.meta());
      if (path === "/v1/providers.json") return cachedJson(req, service.providerList());
      if (path === "/v1/changes.json") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 200) || 200, 1), 2000);
        return cachedJson(req, service.changeList(limit, url.searchParams.get("provider")));
      }
      const provider = /^\/v1\/providers\/([^/]+)\.json$/.exec(path)?.[1];
      if (provider !== undefined) {
        const id = safeDecode(provider);
        const view = id === null ? undefined : service.provider(id);
        return view ? cachedJson(req, view) : error(404, `KPMR has no provider ${JSON.stringify(id ?? provider)}.`);
      }
      const model = /^\/v1\/models\/([^/]+)\/(.+)\.json$/.exec(path);
      if (model) {
        const providerId = safeDecode(model[1] as string);
        const modelId = safeDecode(model[2] as string);
        const view = providerId === null || modelId === null ? undefined : service.model(providerId, modelId);
        return view
          ? cachedJson(req, view)
          : error(404, `KPMR has no model ${JSON.stringify(modelId ?? model[2])} for ${JSON.stringify(providerId ?? model[1])}.`);
      }
      return error(404, "Not found.");
    }

    const file = files.get(path);
    if (file) {
      const type = TYPES[extname(path)] ?? "application/octet-stream";
      return cached(req, type, file, path.startsWith("/assets/") ? IMMUTABLE : SITE_CACHE, { "cross-origin-resource-policy": "same-site" });
    }
    if (path.startsWith("/assets/") || extname(path) !== "")
      return { status: 404, headers: { "content-type": TEXT_TYPE, "cache-control": "no-store" }, body: Buffer.from("Not found.\n") };
    return page(req, url);
  };

  return async (req, res) => {
    const method = req.method ?? "GET";
    let out: Reply;
    if (method === "OPTIONS") {
      out = {
        status: 204,
        headers: {
          ...API_HEADERS,
          "access-control-allow-methods": METHODS,
          "access-control-allow-headers": "Accept, If-None-Match",
          "access-control-max-age": "86400",
        },
        body: Buffer.alloc(0),
      };
    } else if (method !== "GET" && method !== "HEAD") {
      out = error(405, "Only GET and HEAD are allowed.", { allow: METHODS });
    } else {
      try {
        out = await route(req, new URL(req.url ?? "/", "http://localhost"));
      } catch (failure) {
        options.onError(failure);
        out = error(500, "Something went wrong; try again shortly.");
      }
    }
    res.writeHead(out.status, {
      ...COMMON,
      ...out.headers,
      ...(out.status === 304 || out.status === 204 ? {} : { "content-length": String(out.body.length) }),
    });
    res.end(method === "HEAD" ? undefined : out.body);
  };
}
