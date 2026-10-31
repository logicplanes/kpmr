import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { FORMAT, MEDIA_TYPE } from "../shared/catalogue.ts";
import type { Body, Service } from "./service.ts";

export const API_CACHE = "public, max-age=60, stale-while-revalidate=600, stale-if-error=86400";
export const IMMUTABLE = "public, max-age=31536000, immutable";
export const PAGE_CACHE = "no-cache";
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";
export const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
export const SUPPORTED_FORMATS = [FORMAT];

const JSON_TYPE = "application/json; charset=utf-8";
const CATALOGUE_TYPE = `${MEDIA_TYPE}; version=${FORMAT}`;
const METHODS = "GET, HEAD, OPTIONS";

const COMMON: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
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
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": JSON_TYPE,
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export function matches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((c) => {
    const tag = c.trim();
    return tag === "*" || tag.replace(/^W\//, "") === etag;
  });
}

export type Negotiated = { ok: true } | { ok: false };

export function negotiate(accept: string | undefined): Negotiated {
  if (!accept) return { ok: true };
  const ranges = accept.split(",").map((part) => {
    const [type = "", ...params] = part.split(";").map((s) => s.trim().toLowerCase());
    const version = params.find((p) => p.startsWith("version="))?.slice(8);
    const q = Number(params.find((p) => p.startsWith("q="))?.slice(2) ?? 1);
    return { type, version, q };
  });
  const acceptable = ranges.filter((r) => r.q > 0);
  if (acceptable.length === 0) return { ok: false };
  for (const r of acceptable) {
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

function cachedJson(req: IncomingMessage, value: unknown): Reply {
  const body = Buffer.from(JSON.stringify(value));
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
  const headers = { ...API_HEADERS, etag, "cache-control": API_CACHE, vary: "Accept-Encoding" };
  if (matches(req.headers["if-none-match"], etag)) return { status: 304, headers, body: Buffer.alloc(0) };
  return { status: 200, headers: { "content-type": JSON_TYPE, ...headers }, body };
}

function catalogueReply(req: IncomingMessage, body: Body, revision: string): Reply {
  const headers: Record<string, string> = {
    ...API_HEADERS,
    etag: body.etag,
    "kpmr-revision": revision,
    "kpmr-signature": body.signature,
    "cache-control": API_CACHE,
    vary: "Accept, Accept-Encoding",
  };
  if (matches(req.headers["if-none-match"], body.etag)) return { status: 304, headers, body: Buffer.alloc(0) };
  const encoding = encodingFor(req.headers["accept-encoding"] as string | undefined);
  const encoded = encoding === "br" ? body.br : encoding === "gzip" ? body.gzip : undefined;
  return {
    status: 200,
    headers: { "content-type": CATALOGUE_TYPE, ...headers, ...(encoded && encoding ? { "content-encoding": encoding } : {}) },
    body: encoded ?? body.bytes,
  };
}

export function providerFilter(value: string | null): Set<string> | null {
  if (value === null) return null;
  const ids = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(s));
  return new Set(ids.slice(0, 500));
}

const ROBOTS = "User-agent: *\nAllow: /\nDisallow: /v1/\n";

export interface HandlerOptions {
  webDir: string;
  onError: (error: unknown) => void;
}

export function createHandler(service: Service, options: HandlerOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const files = new Map<string, Promise<Buffer | null>>();
  const read = (path: string) => {
    let file = files.get(path);
    if (!file) {
      file = readFile(path).catch(() => null);
      files.set(path, file);
    }
    return file;
  };
  const root = normalize(options.webDir);

  const notReady = () => error(503, "The catalogue is not ready yet; try again shortly.", { "retry-after": String(service.retryAfterSeconds()) });

  const page = async (req: IncomingMessage, path: string): Promise<Reply> => {
    const target = normalize(join(root, decodeURIComponent(path)));
    if (target !== root && !target.startsWith(root + sep)) return error(404, "Not found.");
    const asset = path.startsWith("/assets/");
    const ext = extname(target);
    const bytes = ext && ext !== ".html" ? await read(target) : null;
    if (asset && !bytes) return error(404, "Not found.");
    const body = bytes ?? (await read(join(root, "index.html")));
    if (!body) return error(503, "The registry's pages are missing from this build.");
    const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
    const headers: Record<string, string> = {
      "content-type": bytes ? (TYPES[ext] ?? "application/octet-stream") : (TYPES[".html"] as string),
      "content-security-policy": PAGE_CSP,
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-site",
      "cache-control": asset ? IMMUTABLE : PAGE_CACHE,
      etag,
    };
    if (matches(req.headers["if-none-match"], etag)) return { status: 304, headers, body: Buffer.alloc(0) };
    return { status: 200, headers, body };
  };

  const route = async (req: IncomingMessage, url: URL): Promise<Reply> => {
    const path = url.pathname;
    if (path === "/healthz") return json(200, service.health(), { "cache-control": "no-store" });
    if (path === "/robots.txt")
      return { status: 200, headers: { "content-type": TYPES[".txt"] as string, "cache-control": "public, max-age=3600" }, body: Buffer.from(ROBOTS) };
    if (path === "/v1/keys.json") return cachedJson(req, service.keys());

    if (path === "/v1/catalogue") {
      if (!negotiate(req.headers.accept).ok)
        return error(406, `KPMR serves the catalogue as ${MEDIA_TYPE} in format ${SUPPORTED_FORMATS.join(", ")}.`, {}, { supported: SUPPORTED_FORMATS });
      const body = service.catalogueBody(providerFilter(url.searchParams.get("providers")));
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
        const view = service.provider(decodeURIComponent(provider));
        return view ? cachedJson(req, view) : error(404, `KPMR has no provider ${JSON.stringify(decodeURIComponent(provider))}.`);
      }
      const model = /^\/v1\/models\/([^/]+)\/(.+)\.json$/.exec(path);
      if (model) {
        const [providerId, modelId] = [decodeURIComponent(model[1] as string), decodeURIComponent(model[2] as string)];
        const view = service.model(providerId, modelId);
        return view ? cachedJson(req, view) : error(404, `KPMR has no model ${JSON.stringify(modelId)} for ${JSON.stringify(providerId)}.`);
      }
      return error(404, "Not found.");
    }
    return page(req, path);
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
