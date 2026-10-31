import { createHash } from "node:crypto";
import type { Json, JsonObject, Overlay, Rule } from "../registry/schema.ts";
import { FORMAT, type Catalogue, type CatalogueModel, type CatalogueProvider, type Price, type Prices, type Status } from "../shared/catalogue.ts";
import { decimalText, multiplyDecimal } from "./decimal.ts";
import { equal, isObject, leaves, type Merged, type ModelOrigin } from "./merge.ts";

export const REFRESH_SECONDS = 3600;

const REGISTRY_TO_CATALOGUE: [string, string][] = [
  ["name", "name"],
  ["description", "description"],
  ["family", "family"],
  ["type", "kind"],
  ["status", "status"],
  ["experimental", "status"],
  ["release_date", "release_date"],
  ["last_updated", "last_updated"],
  ["knowledge", "knowledge"],
  ["open_weights", "open_weights"],
  ["modalities", "modalities"],
  ["limit", "limits"],
  ["cost.context_over_200k", "pricing.above_200k"],
  ["cost", "pricing"],
  ["attachment", "capabilities.attachments"],
  ["reasoning_options", "reasoning.efforts"],
  ["reasoning", "capabilities.reasoning"],
  ["tool_call", "capabilities.tool_call"],
  ["structured_output", "capabilities.structured_output"],
  ["temperature", "capabilities.temperature"],
  ["interleaved", "capabilities.interleaved_reasoning"],
  ["kaeso.forced_tool_choice", "capabilities.forced_tool_choice"],
  ["kaeso.adaptive_thinking", "reasoning.adaptive_thinking"],
  ["kaeso.thinking_binding", "reasoning.thinking_binding"],
  ["kaeso.efforts", "reasoning.efforts"],
  ["kaeso.egress_dialect", "gateway.egress_dialect"],
];

export function cataloguePath(registryPath: string): string | null {
  for (const [from, to] of REGISTRY_TO_CATALOGUE) {
    if (registryPath === from) return to;
    if (registryPath.startsWith(`${from}.`)) return `${to}${registryPath.slice(from.length)}`;
  }
  return null;
}

const str = (v: Json | undefined): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const bool = (v: Json | undefined): boolean | null => (typeof v === "boolean" ? v : null);
const int = (v: Json | undefined): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
const price = (v: Json | undefined): Price => {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return decimalText(v);
  if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v)) return v;
  return null;
};
const strings = (v: Json | undefined): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

function prices(cost: JsonObject): Prices {
  return { input: price(cost.input), output: price(cost.output), cache_read: price(cost.cache_read), cache_write: price(cost.cache_write) };
}

function status(model: JsonObject): Status {
  if (model.status === "deprecated") return "deprecated";
  if (model.status === "alpha" || model.status === "beta" || model.experimental === true) return "preview";
  return "active";
}

function efforts(model: JsonObject, kaeso: JsonObject): string[] | null {
  if (Array.isArray(kaeso.efforts)) return strings(kaeso.efforts);
  if (!Array.isArray(model.reasoning_options)) return null;
  for (const option of model.reasoning_options) if (isObject(option) && option.type === "effort") return strings(option.values);
  return null;
}

function interleaved(v: Json | undefined): boolean | null {
  if (typeof v === "boolean") return v;
  return isObject(v) ? true : null;
}

export function catalogueModel(id: string, model: JsonObject, origin: ModelOrigin, corrected: string[] = []): CatalogueModel {
  const cost = isObject(model.cost) ? model.cost : {};
  const limit = isObject(model.limit) ? model.limit : {};
  const modalities = isObject(model.modalities) ? model.modalities : {};
  const kaeso = isObject(model.kaeso) ? model.kaeso : {};
  const kind = str(model.type) ?? "generation";
  const reasons = model.reasoning === true;
  return {
    id,
    name: str(model.name),
    description: str(model.description),
    family: str(model.family),
    kind,
    status: status(model),
    release_date: str(model.release_date),
    last_updated: str(model.last_updated),
    knowledge: str(model.knowledge),
    open_weights: bool(model.open_weights),
    modalities: { input: strings(modalities.input), output: strings(modalities.output) },
    limits: { context: int(limit.context), input: int(limit.input), output: int(limit.output) },
    pricing: {
      unit: "usd_per_million_tokens",
      ...prices(cost),
      cache_write_1h: price(cost.cache_write_1h),
      reasoning: price(cost.reasoning),
      input_audio: price(cost.input_audio),
      output_audio: price(cost.output_audio),
      above_200k: isObject(cost.context_over_200k) ? prices(cost.context_over_200k) : null,
    },
    capabilities: {
      tool_call: bool(model.tool_call),
      forced_tool_choice: bool(kaeso.forced_tool_choice),
      structured_output: bool(model.structured_output),
      temperature: bool(model.temperature),
      attachments: bool(model.attachment),
      reasoning: bool(model.reasoning),
      interleaved_reasoning: interleaved(model.interleaved),
    },
    reasoning: reasons
      ? { efforts: efforts(model, kaeso), adaptive_thinking: bool(kaeso.adaptive_thinking), thinking_binding: bool(kaeso.thinking_binding) }
      : null,
    gateway: { egress_dialect: str(kaeso.egress_dialect) ?? (kind === "embedding" ? "openai_embeddings" : null) },
    origin: origin === "added" ? "kpmr" : "models_dev",
    corrected,
  };
}

const SKIPPED = new Set(["id", "origin", "corrected"]);

function flat(model: CatalogueModel): Map<string, Json> {
  const out = new Map<string, Json>();
  for (const [key, value] of Object.entries(model)) {
    if (SKIPPED.has(key)) continue;
    if (isObject(value as Json)) for (const [path, leaf] of leaves(value as Json, key)) out.set(path, leaf);
    else out.set(key, value as Json);
  }
  return out;
}

export function correctedPaths(original: CatalogueModel, now: CatalogueModel): string[] {
  const a = flat(original);
  const b = flat(now);
  return [...new Set([...a.keys(), ...b.keys()])].filter((path) => !equal(a.get(path), b.get(path))).sort();
}

function applyRules(models: JsonObject, rules: Rule[]): void {
  for (const rule of rules) {
    const [, from] = rule.from.split(".") as [string, string];
    const [, set] = rule.set.split(".") as [string, string];
    for (const [id, model] of Object.entries(models)) {
      if (!isObject(model)) continue;
      const cost = isObject(model.cost) ? model.cost : null;
      const base = cost ? price(cost[from]) : null;
      if (!cost || base === null || cost[set] !== undefined) continue;
      models[id] = { ...model, cost: { ...cost, [set]: multiplyDecimal(base, rule.multiply) } };
    }
  }
}

export interface Built {
  providers: Record<string, CatalogueProvider>;
  providerIds: string[];
}

export function buildProviders(merged: Merged, overlay: Overlay): Built {
  const providers: Record<string, CatalogueProvider> = {};
  for (const [id, raw] of Object.entries(merged.document)) {
    const models = { ...(isObject(raw.models) ? raw.models : {}) };
    applyRules(
      models,
      overlay.rules.filter((r) => r.provider === id),
    );
    const origins = merged.origins.get(id) ?? new Map<string, ModelOrigin>();
    const upstreamModels = merged.upstream[id]?.models;
    const out: Record<string, CatalogueModel> = {};
    for (const [modelId, model] of Object.entries(models)) {
      if (!isObject(model)) continue;
      const origin = origins.get(modelId) ?? "upstream";
      const now = catalogueModel(modelId, model, origin);
      const original = isObject(upstreamModels) ? upstreamModels[modelId] : undefined;
      if (origin !== "added" && isObject(original)) now.corrected = correctedPaths(catalogueModel(modelId, original, "upstream"), now);
      out[modelId] = now;
    }
    providers[id] = {
      id,
      name: str(raw.name) ?? id,
      docs_url: str(raw.doc),
      api_url: str(raw.api),
      env: strings(raw.env),
      origin: overlay.providers.get(id)?.action === "add" && !merged.upstreamProviders.has(id) ? "kpmr" : "models_dev",
      models: out,
    };
  }
  return { providers, providerIds: Object.keys(providers) };
}

export function contentHash(providers: Record<string, CatalogueProvider>, providerIds: string[]): string {
  return createHash("sha256").update(JSON.stringify({ providerIds, providers })).digest("hex").slice(0, 12);
}

export interface CatalogueInput {
  built: Built;
  generatedAt: string;
  modelsDev: { url: string; fetchedAt: string; sha256: string };
  registry: { commit: string; entries: number };
}

export function catalogue(input: CatalogueInput, only?: ReadonlySet<string>): Catalogue {
  const providers = only ? Object.fromEntries(Object.entries(input.built.providers).filter(([id]) => only.has(id))) : input.built.providers;
  return {
    format: FORMAT,
    revision: `${input.generatedAt}-${contentHash(input.built.providers, input.built.providerIds)}`,
    generated_at: input.generatedAt,
    refresh_seconds: REFRESH_SECONDS,
    sources: {
      models_dev: { url: input.modelsDev.url, fetched_at: input.modelsDev.fetchedAt, sha256: input.modelsDev.sha256 },
      registry: input.registry,
    },
    provider_ids: input.built.providerIds,
    providers,
  };
}
