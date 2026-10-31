import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { parseRegistry } from "../../registry/load.ts";
import type { Logger } from "../log.ts";
import { Service } from "../service.ts";
import { REGISTRY, TODAY, UPSTREAM } from "./fixtures.ts";

export const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export function testKey(): string {
  return generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();
}

export interface FakeUpstream {
  fetch: typeof fetch;
  body: unknown;
  status: number;
  etag: string;
  requests: { url: string; ifNoneMatch: string | null }[];
}

export function fakeUpstream(): FakeUpstream {
  const state: FakeUpstream = {
    body: structuredClone(UPSTREAM),
    status: 200,
    etag: '"v1"',
    requests: [],
    fetch: (async (url: string, init?: RequestInit) => {
      const ifNoneMatch = new Headers(init?.headers).get("if-none-match");
      state.requests.push({ url, ifNoneMatch });
      if (state.status !== 200) return new Response("nope", { status: state.status });
      if (ifNoneMatch === state.etag) return new Response(null, { status: 304 });
      return new Response(JSON.stringify(state.body), { status: 200, headers: { etag: state.etag, "content-type": "application/json" } });
    }) as typeof fetch,
  };
  return state;
}

export async function makeService(options: { dataDir?: string; upstream?: FakeUpstream; now?: { value: number }; revision?: string; key?: string } = {}) {
  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), "kpmr-data-")));
  const upstream = options.upstream ?? fakeUpstream();
  const now = options.now ?? { value: Date.parse("2026-10-31T12:00:00Z") };
  const service = new Service({
    dataDir,
    overlay: parseRegistry(REGISTRY, TODAY, options.revision ?? "r1"),
    modelsDevUrl: "https://models.example/api.json",
    fetch: upstream.fetch,
    clock: { now: () => now.value },
    log: quiet,
    signingKey: options.key ?? testKey(),
    signingKeyId: "test-key",
  });
  await service.start();
  return { service, dataDir, upstream, now };
}
