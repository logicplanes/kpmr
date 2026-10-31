import type { Json } from "../registry/schema.ts";
import type { CatalogueModel, CatalogueProvider, Change } from "../shared/catalogue.ts";
import { equal, leaves } from "./merge.ts";

const IGNORED = new Set(["id", "description", "last_updated", "corrected", "origin"]);

function flat(model: CatalogueModel): Map<string, Json> {
  const out = new Map<string, Json>();
  for (const [key, value] of Object.entries(model)) {
    if (IGNORED.has(key)) continue;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) for (const [path, leaf] of leaves(value as Json, key)) out.set(path, leaf);
    else out.set(key, value as Json);
  }
  return out;
}

export function diffProviders(
  before: Record<string, CatalogueProvider>,
  after: Record<string, CatalogueProvider>,
  cause: Change["cause"],
  at: string,
): Change[] {
  const changes: Change[] = [];
  const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const provider of ids) {
    const old = before[provider]?.models ?? {};
    const now = after[provider]?.models ?? {};
    for (const model of [...new Set([...Object.keys(old), ...Object.keys(now)])].sort()) {
      const a = old[model];
      const b = now[model];
      if (!a && b) changes.push({ at, cause, provider, model, kind: "added", fields: [] });
      else if (a && !b) changes.push({ at, cause, provider, model, kind: "removed", fields: [] });
      else if (a && b) {
        const fa = flat(a);
        const fb = flat(b);
        const fields = [...new Set([...fa.keys(), ...fb.keys()])]
          .sort()
          .filter((path) => !equal(fa.get(path), fb.get(path)))
          .map((path) => ({ path, before: fa.get(path) ?? null, after: fb.get(path) ?? null }));
        if (fields.length > 0) changes.push({ at, cause, provider, model, kind: "changed", fields });
      }
    }
  }
  return changes;
}
