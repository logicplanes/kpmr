import { createHash } from "node:crypto";
import type { JsonObject } from "../registry/schema.ts";
import { isObject, type Upstream } from "./merge.ts";

export const MAX_BYTES = 64 << 20;
export const USER_AGENT = "kpmr (+https://kpmr.kaeso.app)";

export type Fetch = typeof fetch;

export type Fetched = { kind: "unchanged" } | { kind: "body"; bytes: Buffer; etag: string | null; sha256: string };

export async function fetchUpstream(fetcher: Fetch, url: string, etag: string | null): Promise<Fetched> {
  const response = await fetcher(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT, ...(etag ? { "if-none-match": etag } : {}) },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status === 304) return { kind: "unchanged" };
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new Error(`${url} is larger than ${MAX_BYTES >> 20} MiB`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error(`${url} is larger than ${MAX_BYTES >> 20} MiB`);
  return { kind: "body", bytes, etag: response.headers.get("etag"), sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function parseUpstream(bytes: Buffer): Upstream {
  let doc: unknown;
  try {
    doc = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`models.dev sent something that is not JSON: ${(error as Error).message}`, { cause: error });
  }
  if (!isObject(doc)) throw new Error("models.dev sent JSON that is not an object of providers");
  const out: Upstream = {};
  for (const [id, provider] of Object.entries(doc)) {
    if (!isObject(provider) || !isObject(provider.models)) continue;
    const models: JsonObject = {};
    for (const [modelId, model] of Object.entries(provider.models)) if (isObject(model)) models[modelId] = { ...model, id: modelId };
    out[id] = { ...provider, id, models };
  }
  if (Object.keys(out).length === 0) throw new Error("models.dev sent no providers");
  return out;
}
