import { describe, expect, it } from "vitest";
import { readConfig, parseDuration } from "./config.ts";
import { fetchUpstream, parseUpstream } from "./upstream.ts";

describe("configuration", () => {
  it("has defaults and reads every variable", () => {
    expect(readConfig({})).toMatchObject({
      port: 8080,
      dataDir: "/data",
      pollMs: 600_000,
      modelsDevUrl: "https://models.dev/api.json",
      revision: "dev",
      signingKeyId: "kpmr-2026-10",
    });
    const c = readConfig({
      PORT: "9000",
      KPMR_POLL: "1h",
      KPMR_DATA: "/d",
      KPMR_REVISION: "abc",
      KPMR_SIGNING_KEY: "a\\nb",
      KPMR_MODELS_DEV_URL: "http://localhost:1/x",
    });
    expect(c).toMatchObject({ port: 9000, pollMs: 3_600_000, dataDir: "/d", revision: "abc", signingKey: "a\nb" });
  });

  it("refuses values it can't use", () => {
    expect(() => readConfig({ PORT: "0" })).toThrow("PORT");
    expect(() => readConfig({ KPMR_POLL: "10s" })).toThrow("at least 1m");
    expect(() => readConfig({ KPMR_MODELS_DEV_URL: "ftp://x" })).toThrow("http or https");
    expect(() => readConfig({ KPMR_MODELS_DEV_URL: "not a url" })).toThrow("http or https");
    expect(() => readConfig({ KPMR_REVISION: "a b" })).toThrow("KPMR_REVISION");
    expect(() => readConfig({ KPMR_SIGNING_KEY_ID: "a/b" })).toThrow("KPMR_SIGNING_KEY_ID");
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("soon")).toBeNull();
  });
});

describe("models.dev data", () => {
  it("keeps providers with models and sets ids from the keys", () => {
    const doc = parseUpstream(Buffer.from(JSON.stringify({ a: { models: { m: { id: "other" }, bad: 3 } }, b: { name: "no models" }, c: 1 })));
    expect(doc).toEqual({ a: { id: "a", models: { m: { id: "m" } } } });
    expect(() => parseUpstream(Buffer.from("[]"))).toThrow("not an object");
    expect(() => parseUpstream(Buffer.from("{}"))).toThrow("no providers");
    expect(() => parseUpstream(Buffer.from("{"))).toThrow("not JSON");
  });

  it("refuses an answer that is too large or an error", async () => {
    const big = (async () => new Response("x", { headers: { "content-length": String(65 << 20) } })) as typeof fetch;
    await expect(fetchUpstream(big, "https://m.example", null)).rejects.toThrow("larger than 64 MiB");
    const down = (async () => new Response("x", { status: 502 })) as typeof fetch;
    await expect(fetchUpstream(down, "https://m.example", null)).rejects.toThrow("answered 502");
  });
});

describe("the signing key file", () => {
  it("reads the key from a file and names a file it can't read", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "kpmr-key-"));
    await writeFile(join(dir, "k.pem"), "PEM");
    expect(readConfig({ KPMR_SIGNING_KEY_FILE: join(dir, "k.pem") }).signingKey).toBe("PEM");
    expect(() => readConfig({ KPMR_SIGNING_KEY_FILE: join(dir, "missing.pem") })).toThrow("cannot be read");
  });
});
