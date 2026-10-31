import { createHash, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { entryCount } from "../registry/load.ts";
import type { Overlay } from "../registry/schema.ts";
import type {
  Catalogue,
  CatalogueProvider,
  Change,
  Meta,
  ModelSummary,
  ModelView,
  ProviderSummary,
  ProviderView,
  RegistryEntryView,
} from "../shared/catalogue.ts";
import { buildProviders, catalogue, contentHash, REFRESH_SECONDS, type Built } from "./catalogue.ts";
import { diffProviders } from "./diff.ts";
import { writeAtomic } from "./files.ts";
import { errorMessage, type Logger } from "./log.ts";
import { mergeRegistry, type Merged, type Upstream } from "./merge.ts";
import { signatureHeader, signer, type Signer } from "./sign.ts";
import { fetchUpstream, parseUpstream, type Fetch } from "./upstream.ts";

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

export const MAX_CHANGES = 2000;

export interface Clock {
  now: () => number;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface Body {
  bytes: Buffer;
  etag: string;
  signature: string;
  gzip?: Buffer;
  br?: Buffer;
}

interface State {
  version: 1;
  models_dev: { etag: string | null; sha256: string; fetched_at: string; checked_at: string; last_error: string | null } | null;
  published: { hash: string; generated_at: string; registry: string } | null;
}

interface Publication {
  upstream: Upstream;
  merged: Merged;
  built: Built;
  catalogue: Catalogue;
  full: Body;
  filtered: Map<string, Promise<Body>>;
  meta: Meta;
  providers: ProviderSummary[];
}

export interface ServiceOptions {
  dataDir: string;
  overlay: Overlay;
  modelsDevUrl: string;
  fetch: Fetch;
  clock: Clock;
  log: Logger;
  signingKey: string | undefined;
  signingKeyId: string;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export async function bodyOf(value: unknown, s: Signer, compress: boolean): Promise<Body> {
  const bytes = Buffer.from(JSON.stringify(value));
  const etag = `"${createHash("sha256").update(bytes).digest("base64url").slice(0, 27)}"`;
  const body: Body = { bytes, etag, signature: signatureHeader(s, bytes) };
  if (compress && bytes.length > 1024) {
    body.gzip = await gzipAsync(bytes, { level: 6 });
    body.br = await brotliAsync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } });
  }
  return body;
}

function entryView(entry: {
  action: RegistryEntryView["action"];
  note: string | null;
  sources: RegistryEntryView["sources"];
  fields: unknown;
  file: string;
  unset?: string[];
}): RegistryEntryView {
  return { action: entry.action, note: entry.note, sources: entry.sources, fields: entry.fields, unset: entry.unset ?? [], file: entry.file };
}

function capabilities(m: CatalogueProvider["models"][string]): string[] {
  const out: string[] = [];
  if (m.capabilities.tool_call) out.push("tools");
  if (m.capabilities.reasoning) out.push("reasoning");
  if (m.modalities.input.includes("image")) out.push("vision");
  if (m.modalities.input.includes("pdf")) out.push("pdf");
  if (m.capabilities.structured_output) out.push("structuredOutput");
  return out;
}

export function modelSummaries(provider: CatalogueProvider): ModelSummary[] {
  return Object.values(provider.models).map((m) => ({
    id: m.id,
    name: m.name,
    family: m.family,
    kind: m.kind,
    status: m.status,
    release_date: m.release_date,
    context: m.limits.context,
    output: m.limits.output,
    input_price: m.pricing.input,
    output_price: m.pricing.output,
    capabilities: capabilities(m),
    origin: m.origin,
    corrected: m.corrected.length,
  }));
}

export class Service {
  private state: State = { version: 1, models_dev: null, published: null };
  private publication: Publication | null = null;
  private changes: Change[] = [];
  private previous: Catalogue | null = null;
  private readonly signer: Signer;
  private timer: NodeJS.Timeout | null = null;
  private polling: Promise<void> | null = null;

  private readonly options: ServiceOptions;

  constructor(options: ServiceOptions) {
    this.options = options;
    if (options.signingKey) this.signer = signer(options.signingKeyId, options.signingKey);
    else {
      const { privateKey } = generateKeyPairSync("ed25519");
      this.signer = signer(`${options.signingKeyId}-ephemeral`, privateKey.export({ format: "pem", type: "pkcs8" }).toString());
      options.log.warn("no signing key set; catalogues are signed with a key made for this run only", { keyid: this.signer.id });
    }
  }

  private file(name: string): string {
    return join(this.options.dataDir, name);
  }

  private async readJson<T>(name: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.file(name), "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(`${this.file(name)} cannot be read: ${errorMessage(error)}`, { cause: error });
    }
  }

  async start(): Promise<void> {
    this.state = (await this.readJson<State>("state.json")) ?? this.state;
    this.changes = (await this.readJson<Change[]>("changes.json")) ?? [];
    this.previous = await this.readJson<Catalogue>("catalogue.json");
    let stored: Buffer | null = null;
    try {
      stored = await readFile(this.file("models-dev.json"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (stored && this.state.models_dev) {
      try {
        await this.publish(parseUpstream(stored), "registry");
      } catch (error) {
        this.options.log.error("the stored models.dev data cannot be used; waiting for a fresh copy", { error: errorMessage(error) });
      }
    }
  }

  schedule(intervalMs: number): void {
    const tick = () => {
      void this.poll().finally(() => {
        this.timer = setTimeout(tick, intervalMs);
        this.timer.unref?.();
      });
    };
    tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    await this.polling;
  }

  poll(): Promise<void> {
    this.polling ??= this.pollOnce().finally(() => (this.polling = null));
    return this.polling;
  }

  private async pollOnce(): Promise<void> {
    const now = iso(this.options.clock.now());
    const known = this.state.models_dev;
    try {
      const fetched = await fetchUpstream(this.options.fetch, this.options.modelsDevUrl, this.publication ? (known?.etag ?? null) : null);
      if (fetched.kind === "unchanged" || (fetched.sha256 === known?.sha256 && this.publication)) {
        if (known) this.state.models_dev = { ...known, checked_at: now, last_error: null };
        await this.saveState();
        return;
      }
      const upstream = parseUpstream(fetched.bytes);
      await writeAtomic(this.file("models-dev.json"), fetched.bytes);
      this.state.models_dev = { etag: fetched.etag, sha256: fetched.sha256, fetched_at: now, checked_at: now, last_error: null };
      await this.publish(upstream, "models_dev");
      this.options.log.info("published models.dev data", { sha256: fetched.sha256.slice(0, 12), revision: this.publication?.catalogue.revision });
    } catch (error) {
      if (known) this.state.models_dev = { ...known, checked_at: now, last_error: errorMessage(error) };
      this.options.log.warn("models.dev check failed; the current catalogue stays in use", { error: errorMessage(error) });
      await this.saveState().catch(() => undefined);
    }
  }

  private async saveState(): Promise<void> {
    await writeAtomic(this.file("state.json"), `${JSON.stringify(this.state, null, 2)}\n`);
  }

  private async publish(upstream: Upstream, cause: Change["cause"]): Promise<void> {
    const { overlay, clock } = this.options;
    const merged = mergeRegistry(upstream, overlay);
    const built = buildProviders(merged, overlay);
    const hash = contentHash(built.providers, built.providerIds);
    const now = iso(clock.now());
    const same = this.state.published?.hash === hash && this.previous !== null;
    const generatedAt = same && this.state.published ? this.state.published.generated_at : now;
    const md = this.state.models_dev as NonNullable<State["models_dev"]>;
    const input = {
      built,
      generatedAt,
      modelsDev: { url: this.options.modelsDevUrl, fetchedAt: md.fetched_at, sha256: md.sha256 },
      registry: { commit: overlay.revision, entries: entryCount(overlay) },
    };
    const full = catalogue(input);

    if (!same) {
      if (this.previous) {
        const found = diffProviders(this.previous.providers, built.providers, this.state.published?.registry !== overlay.revision ? "registry" : cause, now);
        if (found.length > 0) {
          this.changes = [...found.reverse(), ...this.changes].slice(0, MAX_CHANGES);
          await writeAtomic(this.file("changes.json"), JSON.stringify(this.changes));
        }
      }
      await writeAtomic(this.file("catalogue.json"), JSON.stringify(full));
      this.previous = full;
      this.state.published = { hash, generated_at: generatedAt, registry: overlay.revision };
    }
    await this.saveState();

    const body = await bodyOf(full, this.signer, true);
    const providers: ProviderSummary[] = Object.values(built.providers).map((p) => {
      const models = Object.values(p.models);
      return {
        id: p.id,
        name: p.name,
        models: models.length,
        corrected: models.filter((m) => m.corrected.length > 0 && m.origin === "models_dev").length,
        added: models.filter((m) => m.origin === "kpmr").length,
        kaeso: overlay.kaesoProviders.includes(p.id),
        origin: p.origin,
      };
    });
    const all = Object.values(built.providers).flatMap((p) => Object.values(p.models));
    let registryModels = 0;
    for (const m of overlay.models.values()) registryModels += m.size;
    const meta: Meta = {
      revision: full.revision,
      generated_at: full.generated_at,
      format: full.format,
      refresh_seconds: REFRESH_SECONDS,
      models_dev: { url: this.options.modelsDevUrl, fetched_at: md.fetched_at, checked_at: md.checked_at, sha256: md.sha256, last_error: md.last_error },
      registry: {
        commit: overlay.revision,
        entries: entryCount(overlay),
        providers: overlay.providers.size,
        models: registryModels,
        rules: overlay.rules.length,
      },
      catalogue: {
        providers: providers.length,
        models: all.length,
        corrected: all.filter((m) => m.corrected.length > 0 && m.origin === "models_dev").length,
        added: all.filter((m) => m.origin === "kpmr").length,
        bytes: body.bytes.length,
      },
      kaeso_providers: overlay.kaesoProviders,
      notes: merged.notes,
      keys: this.keys(),
    };
    this.publication = { upstream, merged, built, catalogue: full, full: body, filtered: new Map(), meta, providers };
  }

  keys(): Meta["keys"] {
    return [{ id: this.signer.id, algorithm: "ed25519", public_key: this.signer.publicKey }];
  }

  ready(): boolean {
    return this.publication !== null;
  }

  retryAfterSeconds(): number {
    return 30;
  }

  catalogueBody(only: ReadonlySet<string> | null): Promise<Body> | null {
    const p = this.publication;
    if (!p) return null;
    if (!only) return Promise.resolve(p.full);
    const known = [...only].filter((id) => id in p.built.providers).sort();
    const key = known.join(",");
    let body = p.filtered.get(key);
    if (!body) {
      if (p.filtered.size >= 32) p.filtered.delete(p.filtered.keys().next().value as string);
      body = bodyOf(catalogue({ ...this.inputOf(p) }, new Set(known)), this.signer, true);
      p.filtered.set(key, body);
    }
    return body;
  }

  private inputOf(p: Publication) {
    return {
      built: p.built,
      generatedAt: p.catalogue.generated_at,
      modelsDev: {
        url: p.catalogue.sources.models_dev.url,
        fetchedAt: p.catalogue.sources.models_dev.fetched_at,
        sha256: p.catalogue.sources.models_dev.sha256,
      },
      registry: p.catalogue.sources.registry,
    };
  }

  meta(): Meta | null {
    const p = this.publication;
    if (!p) return null;
    const md = this.state.models_dev;
    return md ? { ...p.meta, models_dev: { ...p.meta.models_dev, checked_at: md.checked_at, last_error: md.last_error } } : p.meta;
  }

  providerList(): ProviderSummary[] | null {
    return this.publication?.providers ?? null;
  }

  provider(id: string): ProviderView | null | undefined {
    const p = this.publication;
    if (!p) return null;
    const provider = p.built.providers[id];
    if (!provider) return undefined;
    const { models: _models, ...rest } = provider;
    const entry = this.options.overlay.providers.get(id);
    return {
      provider: rest,
      kaeso: this.options.overlay.kaesoProviders.includes(id),
      entry: entry ? entryView(entry) : null,
      models: modelSummaries(provider),
    };
  }

  model(providerId: string, modelId: string): ModelView | null | undefined {
    const p = this.publication;
    if (!p) return null;
    const provider = p.built.providers[providerId];
    const model = provider?.models[modelId];
    if (!provider || !model) return undefined;
    const upstreamModels = p.upstream[providerId]?.models;
    const original = upstreamModels && typeof upstreamModels === "object" && !Array.isArray(upstreamModels) ? (upstreamModels[modelId] ?? null) : null;
    const entry = this.options.overlay.models.get(providerId)?.get(modelId);
    return {
      provider: { id: provider.id, name: provider.name, kaeso: this.options.overlay.kaesoProviders.includes(providerId) },
      model,
      models_dev: original,
      entry: entry ? entryView(entry) : null,
      rules: this.options.overlay.rules
        .filter((r) => r.provider === providerId && model.corrected.includes(r.set.replace(/^cost\./, "pricing.")))
        .map((r) => ({ set: r.set, from: r.from, multiply: r.multiply, note: r.note, sources: r.sources })),
    };
  }

  changeList(limit: number, provider: string | null): Change[] {
    const list = provider ? this.changes.filter((c) => c.provider === provider) : this.changes;
    return list.slice(0, limit);
  }

  health(): { status: "ok"; ready: boolean; revision: string | null } {
    return { status: "ok", ready: this.ready(), revision: this.publication?.catalogue.revision ?? null };
  }
}
