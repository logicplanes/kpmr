export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const ACTIONS = ["patch", "add", "remove"] as const;
export type Action = (typeof ACTIONS)[number];

export const MODALITIES = ["text", "image", "audio", "video", "pdf"] as const;
export const STATUSES = ["alpha", "beta", "deprecated"] as const;
export const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const DIALECTS = ["anthropic_messages", "openai_chat", "openai_responses", "openai_embeddings"] as const;
export const MAX_PRICE = 1_000_000;

export interface Source {
  url: string;
  checked: string;
  note?: string;
}

export interface ModelEntry {
  provider: string;
  model: string;
  action: Action;
  note: string | null;
  sources: Source[];
  unset: string[];
  fields: JsonObject;
  file: string;
}

export interface ProviderEntry {
  provider: string;
  action: "patch" | "add";
  note: string | null;
  sources: Source[];
  fields: JsonObject;
  file: string;
}

export interface Rule {
  provider: string;
  models: string | null;
  set: string;
  from: string;
  multiply: number;
  note: string | null;
  sources: Source[];
}

export interface Overlay {
  providers: Map<string, ProviderEntry>;
  rules: Rule[];
  models: Map<string, Map<string, ModelEntry>>;
  kaesoProviders: string[];
  revision: string;
}

export class RegistryError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join("\n"));
    this.name = "RegistryError";
    this.problems = problems;
  }
}

type Check = (value: unknown, at: string, problems: string[]) => void;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const describe = (value: unknown): string => (Array.isArray(value) ? "a list" : isObject(value) ? "a table" : JSON.stringify(value));

const text: Check = (value, at, problems) => {
  if (typeof value !== "string" || value.trim() === "") problems.push(`${at} must be a non-empty string, not ${describe(value)}`);
};

const flag: Check = (value, at, problems) => {
  if (typeof value !== "boolean") problems.push(`${at} must be true or false, not ${describe(value)}`);
};

const count: Check = (value, at, problems) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) problems.push(`${at} must be a whole number of 0 or more, not ${describe(value)}`);
};

const price: Check = (value, at, problems) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_PRICE)
    problems.push(`${at} must be a price in USD per million tokens from 0 to ${MAX_PRICE}, not ${describe(value)}`);
};

const oneOf =
  (values: readonly string[]): Check =>
  (value, at, problems) => {
    if (typeof value !== "string" || !values.includes(value)) problems.push(`${at} must be one of ${values.join(", ")}, not ${describe(value)}`);
  };

const dateLike =
  (pattern: RegExp, shape: string): Check =>
  (value, at, problems) => {
    if (typeof value !== "string" || !pattern.test(value)) problems.push(`${at} must be a date as ${shape}, not ${describe(value)}`);
  };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;
const month = dateLike(MONTH, "YYYY-MM or YYYY-MM-DD");

const listOf =
  (item: Check, unique = true): Check =>
  (value, at, problems) => {
    if (!Array.isArray(value)) return void problems.push(`${at} must be a list, not ${describe(value)}`);
    value.forEach((v, i) => item(v, `${at}[${i}]`, problems));
    if (unique && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) problems.push(`${at} lists a value twice`);
  };

const table =
  (fields: Record<string, Check>): Check =>
  (value, at, problems) => {
    if (!isObject(value)) return void problems.push(`${at} must be a table, not ${describe(value)}`);
    for (const [key, v] of Object.entries(value)) {
      const check = fields[key];
      if (!check) problems.push(`${at}.${key} is not a field KPMR knows; known: ${Object.keys(fields).join(", ")}`);
      else check(v, `${at}.${key}`, problems);
    }
  };

const anyTable: Check = (value, at, problems) => {
  if (!isObject(value)) problems.push(`${at} must be a table, not ${describe(value)}`);
};

const COSTS = ["input", "output", "cache_read", "cache_write", "cache_write_1h", "reasoning", "input_audio", "output_audio"] as const;
const costFields = Object.fromEntries(COSTS.map((k) => [k, price]));

export const MODEL_FIELDS: Record<string, Check> = {
  name: text,
  description: text,
  family: text,
  attachment: flag,
  reasoning: flag,
  reasoning_options: listOf(anyTable),
  tool_call: flag,
  structured_output: flag,
  temperature: flag,
  interleaved: (value, at, problems) => (typeof value === "boolean" ? undefined : table({ field: text })(value, at, problems)),
  knowledge: month,
  release_date: month,
  last_updated: month,
  modalities: table({ input: listOf(oneOf(MODALITIES)), output: listOf(oneOf(MODALITIES)) }),
  open_weights: flag,
  experimental: flag,
  limit: table({ context: count, input: count, output: count }),
  cost: table({ ...costFields, context_over_200k: table(costFields) }),
  status: oneOf(STATUSES),
  type: text,
  canonical_model_id: text,
  provider: table({ npm: text, api: text, shape: text }),
  kaeso: table({
    adaptive_thinking: flag,
    thinking_binding: flag,
    forced_tool_choice: flag,
    efforts: listOf(oneOf(EFFORTS)),
    egress_dialect: oneOf(DIALECTS),
  }),
};

const address: Check = (value, at, problems) => {
  if (typeof value !== "string" || !/^https:\/\/[^\s/]+\.[^\s]+$/.test(value)) problems.push(`${at} must be an https address, not ${describe(value)}`);
};

export const PROVIDER_FIELDS: Record<string, Check> = {
  name: text,
  env: listOf(text),
  npm: text,
  api: address,
  doc: address,
};

const NESTED: Record<string, readonly string[]> = {
  modalities: ["input", "output"],
  limit: ["context", "input", "output"],
  cost: [...COSTS, "context_over_200k"],
  provider: ["npm", "api", "shape"],
  kaeso: ["adaptive_thinking", "thinking_binding", "forced_tool_choice", "efforts", "egress_dialect"],
  interleaved: ["field"],
};

export const ADDED_MODEL_REQUIRES = ["name", "modalities", "limit", "cost"] as const;
export const ADDED_PROVIDER_REQUIRES = ["name"] as const;

const HTTPS = /^https:\/\/[^\s/]+\.[^\s]+$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function checkSources(value: unknown, at: string, problems: string[], today: string): Source[] {
  if (!Array.isArray(value) || value.length === 0) {
    problems.push(`${at}.sources must list at least one source: { url = "https://…", checked = YYYY-MM-DD }`);
    return [];
  }
  return value.flatMap((s, i): Source[] => {
    const where = `${at}.sources[${i}]`;
    if (!isObject(s)) return (void problems.push(`${where} must be a table with url and checked`), []);
    const { url, checked, note, ...rest } = s;
    for (const key of Object.keys(rest)) problems.push(`${where}.${key} is not a field of a source; known: url, checked, note`);
    if (typeof url !== "string" || !HTTPS.test(url)) problems.push(`${where}.url must be an https address, not ${describe(url)}`);
    if (typeof checked !== "string" || !DAY.test(checked))
      problems.push(`${where}.checked must be the day it was checked, as YYYY-MM-DD, not ${describe(checked)}`);
    else if (checked > today) problems.push(`${where}.checked is in the future: ${checked}`);
    if (note !== undefined && (typeof note !== "string" || note.trim() === "")) problems.push(`${where}.note must be a non-empty string`);
    return typeof url === "string" && typeof checked === "string" ? [{ url, checked, ...(typeof note === "string" ? { note } : {}) }] : [];
  });
}

export function checkFields(fields: Record<string, unknown>, known: Record<string, Check>, at: string, problems: string[]): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(fields)) {
    const check = known[key];
    if (!check) {
      problems.push(`${at}.${key} is not a field KPMR knows; known: ${Object.keys(known).join(", ")}`);
      continue;
    }
    const before = problems.length;
    check(value, `${at}.${key}`, problems);
    if (problems.length === before) out[key] = value as Json;
  }
  return out;
}

export function checkUnset(value: unknown, at: string, problems: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((p) => typeof p !== "string")) return (void problems.push(`${at}.unset must be a list of field paths`), []);
  const paths = value as string[];
  for (const path of paths) {
    const [top = "", second, third, ...more] = path.split(".");
    const known =
      MODEL_FIELDS[top] !== undefined &&
      more.length === 0 &&
      (second === undefined || (NESTED[top]?.includes(second) ?? false)) &&
      (third === undefined || (top === "cost" && second === "context_over_200k" && (COSTS as readonly string[]).includes(third)));
    if (!known) problems.push(`${at}.unset names ${JSON.stringify(path)}, which is not a field path KPMR knows`);
  }
  if (new Set(paths).size !== paths.length) problems.push(`${at}.unset lists a path twice`);
  return paths;
}
