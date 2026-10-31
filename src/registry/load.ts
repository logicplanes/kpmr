import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, TomlDate } from "smol-toml";
import {
  ACTIONS,
  ADDED_MODEL_REQUIRES,
  ADDED_PROVIDER_REQUIRES,
  MODEL_FIELDS,
  PROVIDER_FIELDS,
  RegistryError,
  checkFields,
  checkSources,
  checkUnset,
  type Action,
  type ModelEntry,
  type Overlay,
  type ProviderEntry,
  type Rule,
} from "./schema.ts";

export interface RegistryFile {
  path: string;
  text: string;
}

const PROVIDER_ID = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const MODEL_ID = /^[\w][\w.:@/+-]*$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);

function plain(value: unknown): unknown {
  if (value instanceof TomlDate) return value.toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}

function note(value: unknown, at: string, problems: string[]): string | null {
  if (value === undefined) return null;
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  problems.push(`${at}.note must be a non-empty string`);
  return null;
}

function action(value: unknown, at: string, problems: string[], allowed: readonly string[] = ACTIONS): Action {
  if (value === undefined) return "patch";
  if (typeof value === "string" && allowed.includes(value)) return value as Action;
  problems.push(`${at}.action must be one of ${allowed.join(", ")}, not ${JSON.stringify(value)}`);
  return "patch";
}

function modelEntry(provider: string, model: string, raw: unknown, file: string, today: string, problems: string[]): ModelEntry | null {
  const at = `${file}: models."${model}"`;
  if (!MODEL_ID.test(model)) problems.push(`${at} is not a model id`);
  if (!isObject(raw)) return (void problems.push(`${at} must be a table`), null);
  const { action: rawAction, note: rawNote, sources: rawSources, unset: rawUnset, ...fields } = raw;
  const entry: ModelEntry = {
    provider,
    model,
    action: action(rawAction, at, problems),
    note: note(rawNote, at, problems),
    sources: checkSources(rawSources, at, problems, today),
    unset: checkUnset(rawUnset, at, problems),
    fields: checkFields(fields, MODEL_FIELDS, at, problems),
    file,
  };
  if (entry.action === "remove") {
    if (Object.keys(fields).length > 0 || entry.unset.length > 0) problems.push(`${at} removes the model, so it sets no fields`);
    if (!entry.note) problems.push(`${at} removes the model, so it says why in note`);
  } else if (entry.action === "add") {
    if (entry.unset.length > 0) problems.push(`${at} adds the model, so there is nothing to unset`);
    for (const key of ADDED_MODEL_REQUIRES) if (!(key in fields)) problems.push(`${at} adds the model, so it sets ${key}`);
  } else if (Object.keys(fields).length === 0 && entry.unset.length === 0) {
    problems.push(`${at} changes nothing: set a field, unset one, or use action = "remove"`);
  }
  return entry;
}

function providerEntry(provider: string, raw: unknown, file: string, today: string, problems: string[]): ProviderEntry | null {
  const at = `${file}: provider`;
  if (!isObject(raw)) return (void problems.push(`${at} must be a table`), null);
  const { action: rawAction, note: rawNote, sources: rawSources, ...fields } = raw;
  const entry: ProviderEntry = {
    provider,
    action: action(rawAction, at, problems, ["patch", "add"]) as "patch" | "add",
    note: note(rawNote, at, problems),
    sources: checkSources(rawSources, at, problems, today),
    fields: checkFields(fields, PROVIDER_FIELDS, at, problems),
    file,
  };
  if (entry.action === "add") for (const key of ADDED_PROVIDER_REQUIRES) if (!(key in fields)) problems.push(`${at} adds the provider, so it sets ${key}`);
  if (entry.action === "patch" && Object.keys(fields).length === 0) problems.push(`${at} changes nothing: set a field or leave the table out`);
  return entry;
}

const PRICE_PATHS = new Set(
  ["input", "output", "cache_read", "cache_write", "cache_write_1h", "reasoning", "input_audio", "output_audio"].map((k) => `cost.${k}`),
);

function rules(raw: unknown, today: string, problems: string[]): Rule[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return (void problems.push("registry/index.toml: rules must be a list of [[rules]] tables"), []);
  return raw.flatMap((r, i): Rule[] => {
    const at = `registry/index.toml: rules[${i}]`;
    if (!isObject(r)) return (void problems.push(`${at} must be a table`), []);
    const { provider, set, from, multiply, note: rawNote, sources, ...rest } = r;
    for (const key of Object.keys(rest)) problems.push(`${at}.${key} is not a field of a rule; known: provider, set, from, multiply, note, sources`);
    if (typeof provider !== "string" || !PROVIDER_ID.test(provider)) problems.push(`${at}.provider must be a provider id`);
    if (typeof set !== "string" || !PRICE_PATHS.has(set)) problems.push(`${at}.set must be a price path such as cost.cache_write_1h`);
    if (typeof from !== "string" || !PRICE_PATHS.has(from)) problems.push(`${at}.from must be a price path such as cost.input`);
    if (typeof multiply !== "number" || !Number.isInteger(multiply * 1000) || multiply <= 0 || multiply > 100)
      problems.push(`${at}.multiply must be a number above 0 and at most 100, with at most three decimals`);
    const checked = checkSources(sources, at, problems, today);
    return [
      { provider: String(provider), set: String(set), from: String(from), multiply: Number(multiply), note: note(rawNote, at, problems), sources: checked },
    ];
  });
}

function index(text: string | undefined, today: string, problems: string[]): { kaesoProviders: string[]; rules: Rule[] } {
  const none = { kaesoProviders: [], rules: [] };
  if (text === undefined) return (void problems.push("registry/index.toml is missing"), none);
  let doc: unknown;
  try {
    doc = plain(parse(text));
  } catch (error) {
    return (void problems.push(`registry/index.toml: ${(error as Error).message}`), none);
  }
  if (!isObject(doc)) return none;
  const { kaeso, rules: rawRules, ...rest } = doc;
  for (const key of Object.keys(rest)) problems.push(`registry/index.toml: ${key} is not a section KPMR knows; known: kaeso, rules`);
  const ids = isObject(kaeso) ? kaeso.providers : undefined;
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string" || !PROVIDER_ID.test(id)))
    problems.push("registry/index.toml: kaeso.providers must list the provider ids Kaeso calls");
  const kaesoProviders = Array.isArray(ids) ? [...(ids as string[])].sort() : [];
  return { kaesoProviders, rules: rules(rawRules, today, problems) };
}

export function parseRegistry(files: RegistryFile[], today: string, revision: string): Overlay {
  const problems: string[] = [];
  const { kaesoProviders, rules } = index(files.find((f) => f.path === "registry/index.toml")?.text, today, problems);
  const overlay: Overlay = { providers: new Map(), rules, models: new Map(), kaesoProviders, revision };

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const id = /^registry\/providers\/([^/]+)\.toml$/.exec(file.path)?.[1];
    if (file.path === "registry/index.toml" || file.path === "registry/README.md") continue;
    if (id === undefined) {
      problems.push(`${file.path} is not where registry files go: registry/providers/<provider id>.toml`);
      continue;
    }
    if (!PROVIDER_ID.test(id)) problems.push(`${file.path}: ${JSON.stringify(id)} is not a provider id (lowercase letters, digits and hyphens)`);
    let doc: unknown;
    try {
      doc = plain(parse(file.text));
    } catch (error) {
      problems.push(`${file.path}: ${(error as Error).message}`);
      continue;
    }
    if (!isObject(doc)) continue;
    const { provider, models, ...rest } = doc;
    for (const key of Object.keys(rest)) problems.push(`${file.path}: ${key} is not a section KPMR knows; known: provider, models`);
    if (provider !== undefined) {
      const entry = providerEntry(id, provider, file.path, today, problems);
      if (entry) overlay.providers.set(id, entry);
    }
    if (models === undefined) {
      if (provider === undefined) problems.push(`${file.path} has neither a provider nor models table`);
      continue;
    }
    if (!isObject(models)) {
      problems.push(`${file.path}: models must be a table of models by id`);
      continue;
    }
    const byId = new Map<string, ModelEntry>();
    for (const [model, raw] of Object.entries(models)) {
      const entry = modelEntry(id, model, raw, file.path, today, problems);
      if (entry) byId.set(model, entry);
    }
    overlay.models.set(id, byId);
  }
  if (problems.length > 0) throw new RegistryError(problems);
  return overlay;
}

async function filesIn(root: string, dir: string): Promise<RegistryFile[]> {
  const entries = await readdir(join(root, dir), { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (e): Promise<RegistryFile[]> => {
      const path = `${dir}/${e.name}`;
      if (e.isDirectory()) return filesIn(root, path);
      return [{ path, text: await readFile(join(root, path), "utf8") }];
    }),
  );
  return nested.flat();
}

export async function loadRegistry(root: string, today: string, revision: string): Promise<Overlay> {
  return parseRegistry(await filesIn(root, "registry"), today, revision);
}

export function entryCount(overlay: Overlay): number {
  let n = overlay.providers.size + overlay.rules.length;
  for (const models of overlay.models.values()) n += models.size;
  return n;
}
