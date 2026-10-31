import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { verifySignature } from "./sign.ts";
import { makeService, quiet, testKey } from "./test/helpers.ts";
import { Service } from "./service.ts";
import { parseRegistry } from "../registry/load.ts";
import { REGISTRY, TODAY } from "./test/fixtures.ts";

describe("the service", () => {
  it("is not ready before models.dev answers, then publishes a signed catalogue", async () => {
    const { service } = await makeService();
    expect(service.ready()).toBe(false);
    expect(service.catalogueBody(null)).toBeNull();
    await service.poll();
    expect(service.ready()).toBe(true);
    const body = await service.catalogueBody(null);
    const key = service.keys()[0];
    expect(key?.id).toBe("test-key");
    expect(verifySignature(body?.signature ?? "", body?.bytes ?? Buffer.alloc(0), { "test-key": key?.public_key ?? "" })).toBe(true);
    expect(verifySignature(body?.signature ?? "", Buffer.from("{}"), { "test-key": key?.public_key ?? "" })).toBe(false);
    expect(verifySignature(body?.signature ?? "", body?.bytes ?? Buffer.alloc(0), {})).toBe(false);
    expect(body?.gzip?.length).toBeGreaterThan(0);
  });

  it("asks models.dev conditionally and keeps the catalogue when it fails", async () => {
    const { service, upstream } = await makeService();
    await service.poll();
    const revision = service.meta()?.revision;
    await service.poll();
    expect(upstream.requests.map((r) => r.ifNoneMatch)).toEqual([null, '"v1"']);
    upstream.status = 500;
    await service.poll();
    expect(service.meta()?.revision).toBe(revision);
    expect(service.meta()?.models_dev.last_error).toContain("answered 500");
    upstream.status = 200;
    upstream.body = "not json";
    upstream.etag = '"v2"';
    await service.poll();
    expect(service.meta()?.models_dev.last_error).toContain("models.dev");
  });

  it("records changes from models.dev and keeps the revision while nothing changes", async () => {
    const now = { value: Date.parse("2026-10-31T12:00:00Z") };
    const { service, upstream } = await makeService({ now });
    await service.poll();
    const first = service.meta()?.revision;
    now.value += 600_000;
    upstream.etag = '"v2"';
    upstream.body = { ...(upstream.body as object), extra: { id: "extra", models: { m: { id: "m", name: "M" } } } };
    await service.poll();
    expect(service.meta()?.revision).not.toBe(first);
    expect(service.changeList(10, null)).toEqual([expect.objectContaining({ provider: "extra", model: "m", kind: "added", cause: "models_dev" })]);
    expect(service.changeList(10, "anthropic")).toEqual([]);
    const second = service.meta()?.revision;
    now.value += 600_000;
    upstream.etag = '"v3"';
    await service.poll();
    expect(service.meta()?.revision).toBe(second);
  });

  it("starts from its data directory, and counts a new registry as the cause", async () => {
    const first = await makeService();
    await first.service.poll();
    const stored = JSON.parse(await readFile(join(first.dataDir, "state.json"), "utf8"));
    expect(stored.models_dev.etag).toBe('"v1"');
    const again = await makeService({ dataDir: first.dataDir, revision: "r1" });
    expect(again.service.ready()).toBe(true);
    expect(again.service.meta()?.revision).toBe(first.service.meta()?.revision);
    const changed = new Service({
      dataDir: first.dataDir,
      overlay: parseRegistry(
        REGISTRY.filter((f) => !f.path.endsWith("example.toml")),
        TODAY,
        "r2",
      ),
      modelsDevUrl: "https://models.example/api.json",
      fetch: first.upstream.fetch,
      clock: { now: () => Date.parse("2026-10-31T13:00:00Z") },
      log: quiet,
      signingKey: testKey(),
      signingKeyId: "k",
    });
    await changed.start();
    expect(changed.changeList(10, null)).toEqual([expect.objectContaining({ provider: "example", kind: "removed", cause: "registry" })]);
  });

  it("serves views of providers and models, and filtered catalogues", async () => {
    const { service } = await makeService();
    await service.poll();
    expect(service.providerList()?.find((p) => p.id === "anthropic")).toEqual({
      id: "anthropic",
      name: "Anthropic",
      models: 3,
      corrected: 2,
      added: 1,
      kaeso: true,
      origin: "models_dev",
    });
    expect(service.provider("nope")).toBeUndefined();
    expect(service.provider("anthropic")?.models.map((m) => m.id)).toEqual(["claude-haiku-4-5", "claude-new", "claude-opus-5-5"]);
    const view = service.model("anthropic", "claude-opus-5-5");
    expect(view?.entry?.note).toBe("No forced tool choice.");
    expect(view?.rules).toEqual([expect.objectContaining({ set: "cost.cache_write_1h", multiply: 2 })]);
    expect((view?.models_dev as { limit: unknown }).limit).toEqual({ context: 1000000, output: 128000 });
    expect(service.model("anthropic", "nope")).toBeUndefined();
    const only = JSON.parse((await service.catalogueBody(new Set(["openai", "missing"])))?.bytes.toString() ?? "{}");
    expect(Object.keys(only.providers)).toEqual(["openai"]);
    expect(await service.catalogueBody(new Set(["openai"]))).toBe(await service.catalogueBody(new Set(["openai", "missing"])));
  });

  it("signs with a key of its own when none is set", () => {
    const warnings: string[] = [];
    const service = new Service({
      dataDir: "/nonexistent",
      overlay: parseRegistry(REGISTRY, TODAY, "r"),
      modelsDevUrl: "https://m.example",
      fetch,
      clock: { now: () => 0 },
      log: { ...quiet, warn: (m) => void warnings.push(m) },
      signingKey: undefined,
      signingKeyId: "kpmr",
    });
    expect(service.keys()[0]?.id).toBe("kpmr-ephemeral");
    expect(warnings).toHaveLength(1);
    expect(
      () =>
        new Service({
          dataDir: "/x",
          overlay: parseRegistry(REGISTRY, TODAY, "r"),
          modelsDevUrl: "https://m.example",
          fetch,
          clock: { now: () => 0 },
          log: quiet,
          signingKey: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
          signingKeyId: "k",
        }),
    ).toThrow("Ed25519");
  });
});

describe("the service under strain", () => {
  it("moves a corrupt data file aside and starts", async () => {
    const { writeFile, readdir } = await import("node:fs/promises");
    const first = await makeService();
    await first.service.poll();
    await writeFile(join(first.dataDir, "state.json"), '{"version":1,');
    await writeFile(join(first.dataDir, "changes.json"), "nope");
    const again = await makeService({ dataDir: first.dataDir });
    expect((await readdir(first.dataDir)).filter((f) => f.includes(".corrupt-")).length).toBe(2);
    await again.service.poll();
    expect(again.service.ready()).toBe(true);
  });

  it("keeps a bounded number of filtered catalogues and builds one at a time", async () => {
    const { service } = await makeService();
    await service.poll();
    const sets = ["anthropic", "openai", "example", "anthropic,openai", "anthropic,example", "openai,example"].map((s) => new Set(s.split(",")));
    const bodies = await Promise.all([...sets, ...sets, ...sets].map((s) => service.catalogueBody(s)));
    expect(bodies.every(Boolean)).toBe(true);
    expect(await service.catalogueBody(new Set(["anthropic", "openai", "example"]))).toBe(await service.catalogueBody(null));
  });
});
