export const FORMAT = 1;
export const MEDIA_TYPE = "application/vnd.kaeso.kpmr+json";

export type Price = string | null;

export interface Prices {
  input: Price;
  output: Price;
  cache_read: Price;
  cache_write: Price;
}

export interface Pricing extends Prices {
  unit: "usd_per_million_tokens";
  cache_write_1h: Price;
  reasoning: Price;
  input_audio: Price;
  output_audio: Price;
  above_200k: Prices | null;
}

export type Origin = "models_dev" | "kpmr";
export type Status = "active" | "preview" | "deprecated";

export interface CatalogueModel {
  id: string;
  name: string | null;
  description: string | null;
  family: string | null;
  kind: string;
  status: Status;
  release_date: string | null;
  last_updated: string | null;
  knowledge: string | null;
  open_weights: boolean | null;
  modalities: { input: string[]; output: string[] };
  limits: { context: number | null; input: number | null; output: number | null };
  pricing: Pricing;
  capabilities: {
    tool_call: boolean | null;
    forced_tool_choice: boolean | null;
    structured_output: boolean | null;
    temperature: boolean | null;
    attachments: boolean | null;
    reasoning: boolean | null;
    interleaved_reasoning: boolean | null;
  };
  reasoning: { efforts: string[] | null; adaptive_thinking: boolean | null; thinking_binding: boolean | null } | null;
  gateway: { egress_dialect: string | null };
  origin: Origin;
  corrected: string[];
}

export interface CatalogueProvider {
  id: string;
  name: string;
  docs_url: string | null;
  api_url: string | null;
  env: string[];
  origin: Origin;
  models: Record<string, CatalogueModel>;
}

export interface Catalogue {
  format: number;
  revision: string;
  generated_at: string;
  refresh_seconds: number;
  sources: {
    models_dev: { url: string; fetched_at: string; sha256: string; license: { spdx: string; copyright: string; url: string } };
    registry: { commit: string; entries: number };
  };
  provider_ids: string[];
  providers: Record<string, CatalogueProvider>;
}

export interface SourceRef {
  url: string;
  checked: string;
  note?: string;
}

export interface RegistryEntryView {
  action: "patch" | "add" | "remove";
  note: string | null;
  sources: SourceRef[];
  fields: unknown;
  unset: string[];
  file: string;
}

export interface ProviderSummary {
  id: string;
  name: string;
  models: number;
  corrected: number;
  added: number;
  kaeso: boolean;
  origin: Origin;
}

export interface ModelSummary {
  id: string;
  name: string | null;
  family: string | null;
  kind: string;
  status: Status;
  release_date: string | null;
  context: number | null;
  output: number | null;
  input_price: Price;
  output_price: Price;
  capabilities: string[];
  origin: Origin;
  corrected: number;
}

export interface ProviderView {
  provider: Omit<CatalogueProvider, "models">;
  kaeso: boolean;
  entry: RegistryEntryView | null;
  models: ModelSummary[];
}

export interface ModelView {
  provider: { id: string; name: string; kaeso: boolean };
  model: CatalogueModel;
  models_dev: unknown;
  entry: RegistryEntryView | null;
  rules: { set: string; from: string; multiply: number; note: string | null; sources: SourceRef[] }[];
}

export type ChangeKind = "added" | "removed" | "changed";

export interface Change {
  at: string;
  cause: "models_dev" | "registry";
  provider: string;
  model: string;
  kind: ChangeKind;
  fields: { path: string; before: unknown; after: unknown }[];
}

export interface NoteView {
  kind: "redundant" | "listed-upstream" | "not-upstream" | "provider-not-upstream";
  provider: string;
  model: string | null;
  fields: string[];
  file: string;
}

export interface Meta {
  revision: string;
  generated_at: string;
  format: number;
  refresh_seconds: number;
  models_dev: { url: string; fetched_at: string; checked_at: string; sha256: string; last_error: string | null };
  registry: { commit: string; entries: number; providers: number; models: number; rules: number };
  catalogue: { providers: number; models: number; corrected: number; added: number; bytes: number };
  kaeso_providers: string[];
  notes: NoteView[];
  keys: { id: string; algorithm: "ed25519"; public_key: string }[];
}
