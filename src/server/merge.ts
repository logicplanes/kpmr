import type { Json, JsonObject, ModelEntry, Overlay } from "../registry/schema.ts";

export type Upstream = Record<string, JsonObject>;
export type ModelOrigin = "upstream" | "patched" | "added";

export type NoteKind = "redundant" | "listed-upstream" | "not-upstream" | "provider-not-upstream";

export interface Note {
  kind: NoteKind;
  provider: string;
  model: string | null;
  fields: string[];
  file: string;
}

export interface Merged {
  document: Upstream;
  origins: Map<string, Map<string, ModelOrigin>>;
  upstream: Upstream;
  upstreamProviders: Set<string>;
  notes: Note[];
}

export const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

export function equal(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => equal(a[k], b[k]));
  }
  return false;
}

export function merge(base: Json | undefined, patch: Json): Json {
  if (!isObject(base) || !isObject(patch)) return structuredClone(patch);
  const out: JsonObject = { ...base };
  for (const [key, value] of Object.entries(patch)) out[key] = merge(base[key], value);
  return out;
}

export function leaves(value: Json, prefix = ""): [string, Json][] {
  if (!isObject(value)) return [[prefix, value]];
  return Object.entries(value).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

function at(value: Json | undefined, path: string): Json | undefined {
  let current = value;
  for (const part of path.split(".")) current = isObject(current) ? current[part] : undefined;
  return current;
}

function unset(model: JsonObject, path: string): boolean {
  const parts = path.split(".");
  const last = parts.pop() as string;
  let parent: Json | undefined = model;
  for (const part of parts) parent = isObject(parent) ? parent[part] : undefined;
  if (!isObject(parent) || !(last in parent)) return false;
  Reflect.deleteProperty(parent, last);
  return true;
}

export function redundantFields(entry: ModelEntry, upstream: JsonObject): string[] {
  const set = leaves(entry.fields).filter(([path, value]) => equal(at(upstream, path), value));
  const unsets = entry.unset.filter((path) => at(upstream, path) === undefined);
  return [...set.map(([path]) => path), ...unsets.map((path) => `unset ${path}`)];
}

function applyModel(models: JsonObject, entry: ModelEntry, notes: Note[], origins: Map<string, ModelOrigin>): void {
  const upstream = models[entry.model];
  const note = (kind: NoteKind, fields: string[] = []): void =>
    void notes.push({ kind, provider: entry.provider, model: entry.model, fields, file: entry.file });
  if (entry.action === "remove") {
    if (isObject(upstream)) {
      Reflect.deleteProperty(models, entry.model);
      origins.delete(entry.model);
    } else note("not-upstream");
    return;
  }
  if (!isObject(upstream)) {
    if (entry.action === "patch") return note("not-upstream");
    models[entry.model] = { id: entry.model, ...structuredClone(entry.fields) };
    origins.set(entry.model, "added");
    return;
  }
  if (entry.action === "add") note("listed-upstream");
  const redundant = redundantFields(entry, upstream);
  const total = leaves(entry.fields).length + entry.unset.length;
  if (entry.action === "patch" && redundant.length > 0) note("redundant", redundant.length === total ? [] : redundant);
  const merged = merge(structuredClone(upstream), entry.fields) as JsonObject;
  for (const path of entry.unset) unset(merged, path);
  merged.id = entry.model;
  models[entry.model] = merged;
  origins.set(entry.model, "patched");
}

function sorted<T>(object: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function mergeRegistry(upstream: Upstream, overlay: Overlay): Merged {
  const document: Upstream = {};
  const origins = new Map<string, Map<string, ModelOrigin>>();
  const notes: Note[] = [];

  for (const [id, provider] of Object.entries(upstream)) {
    const models = isObject(provider.models) ? { ...provider.models } : {};
    document[id] = { ...provider, models };
    origins.set(id, new Map(Object.keys(models).map((m) => [m, "upstream" as ModelOrigin])));
  }

  for (const entry of overlay.providers.values()) {
    const existing = document[entry.provider];
    if (existing) {
      if (entry.action === "add") notes.push({ kind: "listed-upstream", provider: entry.provider, model: null, fields: [], file: entry.file });
      document[entry.provider] = { ...existing, ...structuredClone(entry.fields) };
    } else if (entry.action === "add") {
      document[entry.provider] = { id: entry.provider, ...structuredClone(entry.fields), models: {} };
      origins.set(entry.provider, new Map());
    } else {
      notes.push({ kind: "provider-not-upstream", provider: entry.provider, model: null, fields: [], file: entry.file });
    }
  }

  for (const [providerId, entries] of overlay.models) {
    const provider = document[providerId];
    if (!provider) {
      if (!overlay.providers.has(providerId))
        for (const entry of entries.values())
          notes.push({ kind: "provider-not-upstream", provider: providerId, model: entry.model, fields: [], file: entry.file });
      continue;
    }
    const models = provider.models as JsonObject;
    const providerOrigins = origins.get(providerId) as Map<string, ModelOrigin>;
    for (const entry of entries.values()) applyModel(models, entry, notes, providerOrigins);
  }

  for (const [id, provider] of Object.entries(document)) document[id] = { ...provider, models: sorted(provider.models as JsonObject) };
  return { document: sorted(document), origins, upstream, upstreamProviders: new Set(Object.keys(upstream)), notes };
}

export type FieldOrigin = "upstream" | "kpmr";

export function fieldOrigins(model: JsonObject, entry: ModelEntry | undefined, origin: ModelOrigin): Record<string, FieldOrigin> {
  const out: Record<string, FieldOrigin> = {};
  const set = entry ? leaves(entry.fields).map(([path]) => path) : [];
  for (const [path] of leaves(model)) {
    if (path === "id") continue;
    const fromRegistry = origin === "added" || set.some((p) => path === p || path.startsWith(`${p}.`) || p.startsWith(`${path}.`));
    out[path] = fromRegistry ? "kpmr" : "upstream";
  }
  return out;
}
