import { describe, expect, it } from "vitest";
import { parseRegistry } from "../registry/load.ts";
import { buildProviders, catalogue, cataloguePath, catalogueModel, patternOf } from "./catalogue.ts";
import { decimalText, multiplyDecimal } from "./decimal.ts";
import { diffProviders } from "./diff.ts";
import { mergeRegistry, type Upstream } from "./merge.ts";
import { REGISTRY, TODAY, UPSTREAM } from "./test/fixtures.ts";

const overlay = parseRegistry(REGISTRY, TODAY, "r1");
const build = (u: unknown = UPSTREAM) => buildProviders(mergeRegistry(structuredClone(u) as Upstream, overlay), overlay);

describe("the catalogue", () => {
  it("describes a model in Kaeso's format, with exact prices and what KPMR changed", () => {
    const opus = build().providers.anthropic?.models["claude-opus-5-5"];
    expect(opus).toEqual({
      id: "claude-opus-5-5",
      name: "Claude Opus 5.5",
      description: null,
      family: "claude-opus",
      kind: "generation",
      status: "active",
      release_date: "2026-09-22",
      last_updated: "2026-09-22",
      knowledge: "2026-06",
      open_weights: false,
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      limits: { context: 1000000, input: null, output: 64000 },
      pricing: {
        unit: "usd_per_million_tokens",
        input: "4",
        output: "20",
        cache_read: "0.2",
        cache_write: "5",
        cache_write_1h: "8",
        reasoning: null,
        input_audio: null,
        output_audio: null,
        above_200k: null,
      },
      capabilities: {
        tool_call: true,
        forced_tool_choice: false,
        structured_output: true,
        temperature: false,
        attachments: true,
        reasoning: true,
        interleaved_reasoning: null,
      },
      reasoning: { efforts: ["low", "medium", "high", "xhigh", "max"], adaptive_thinking: true, thinking_binding: true },
      gateway: { egress_dialect: null },
      origin: "models_dev",
      corrected: ["capabilities.forced_tool_choice", "limits.output", "pricing.cache_write_1h", "reasoning.adaptive_thinking", "reasoning.thinking_binding"],
    });
  });

  it("marks added models and providers, deprecations and embedding models", () => {
    const built = build();
    expect(built.providers.anthropic?.models["claude-new"]).toMatchObject({ origin: "kpmr", corrected: [], pricing: { input: "1.25", cache_write_1h: "2.5" } });
    expect(built.providers.anthropic?.models["claude-haiku-4-5"]).toMatchObject({
      status: "deprecated",
      corrected: ["pricing.cache_write_1h", "pricing.output"],
      pricing: { output: null },
    });
    expect(built.providers.openai?.models["text-embedding-3-small"]).toMatchObject({
      kind: "embedding",
      gateway: { egress_dialect: "openai_embeddings" },
      reasoning: null,
    });
    expect(built.providers.example).toMatchObject({ origin: "kpmr", name: "Example AI", docs_url: "https://example.com" });
    expect(built.providerIds).toEqual(["anthropic", "example", "openai"]);
  });

  it("reads efforts from the registry first and models.dev second, and statuses from both", () => {
    const m = catalogueModel(
      "m",
      { reasoning: true, status: "beta", kaeso: { efforts: [] }, reasoning_options: [{ type: "effort", values: ["high"] }] },
      "upstream",
    );
    expect(m.reasoning?.efforts).toEqual([]);
    expect(m.status).toBe("preview");
    expect(catalogueModel("m", { experimental: true, interleaved: { field: "r" } }, "upstream")).toMatchObject({
      status: "preview",
      capabilities: { interleaved_reasoning: true },
    });
    expect(catalogueModel("m", { reasoning: true }, "upstream").reasoning?.efforts).toBeNull();
    expect(catalogueModel("m", { cost: { input: "0.5", context_over_200k: { input: 6 } } }, "upstream").pricing).toMatchObject({
      input: "0.5",
      above_200k: { input: "6", output: null },
    });
  });

  it("filters providers but always lists every provider id, and keeps the revision", () => {
    const input = {
      built: build(),
      generatedAt: "2026-10-31T00:00:00Z",
      modelsDev: { url: "u", fetchedAt: "f", sha256: "s" },
      registry: { commit: "r1", entries: 8 },
    };
    const all = catalogue(input);
    const some = catalogue(input, new Set(["openai"]));
    expect(Object.keys(some.providers)).toEqual(["openai"]);
    expect(some.provider_ids).toEqual(all.provider_ids);
    expect(some.revision).toBe(all.revision);
    expect(all.revision).toMatch(/^2026-10-31T00:00:00Z-[0-9a-f]{12}$/);
    expect(all).toMatchObject({ format: 1, refresh_seconds: 3600 });
  });

  it("maps registry paths to catalogue paths", () => {
    expect(cataloguePath("cost.cache_write")).toBe("pricing.cache_write");
    expect(cataloguePath("cost.context_over_200k.input")).toBe("pricing.above_200k.input");
    expect(cataloguePath("kaeso.egress_dialect")).toBe("gateway.egress_dialect");
    expect(cataloguePath("canonical_model_id")).toBeNull();
  });
});

describe("decimals", () => {
  it("writes prices exactly and multiplies them without floating point", () => {
    expect(decimalText(0.1)).toBe("0.1");
    expect(decimalText(1e-7)).toBe("0.0000001");
    expect(() => decimalText(-1)).toThrow();
    expect(multiplyDecimal("0.1", 3)).toBe("0.3");
    expect(multiplyDecimal("3.75", 2)).toBe("7.5");
    expect(multiplyDecimal("2", 1.25)).toBe("2.5");
  });
});

describe("changes", () => {
  it("lists added, removed and changed models with every changed field", () => {
    const before = build().providers;
    const next = structuredClone(UPSTREAM);
    next.anthropic.models["claude-opus-5-5"].cost.input = 5;
    delete (next.openai.models as Record<string, unknown>)["text-embedding-3-small"];
    const after = build(next).providers;
    const changes = diffProviders(before, after, "models_dev", "t");
    expect(changes).toEqual([
      {
        at: "t",
        cause: "models_dev",
        provider: "anthropic",
        model: "claude-opus-5-5",
        kind: "changed",
        fields: [
          { path: "pricing.cache_write_1h", before: "8", after: "10" },
          { path: "pricing.input", before: "4", after: "5" },
        ],
      },
      { at: "t", cause: "models_dev", provider: "openai", model: "text-embedding-3-small", kind: "removed", fields: [] },
    ]);
    expect(diffProviders(after, before, "registry", "t")[1]).toMatchObject({ kind: "added", cause: "registry" });
  });
});

describe("review fixes", () => {
  it("normalises float artefacts and keeps tiny and huge prices exact", () => {
    expect(decimalText(0.04499999999999999)).toBe("0.045");
    expect(decimalText(0.1 + 0.2)).toBe("0.3");
    expect(decimalText(1e-13)).toBe("0.0000000000001");
    expect(decimalText(1e21)).toBe("1000000000000000000000");
    expect(decimalText(0)).toBe("0");
    expect(multiplyDecimal("0.04499999999999999", 2)).toBe("0.08999999999999998");
    expect(multiplyDecimal("1.25", 0.5)).toBe("0.625");
  });

  it("drops prices above the cap and keeps rules off prices an entry unsets", () => {
    expect(catalogueModel("m", { cost: { input: 2_000_000, output: "3000001" } }, "upstream").pricing).toMatchObject({ input: null, output: null });
    const files = REGISTRY.map((f) =>
      f.path.endsWith("anthropic.toml") ? { ...f, text: f.text.replace('unset = ["cost.output"]', 'unset = ["cost.output", "cost.cache_write_1h"]') } : f,
    );
    const o = parseRegistry(files, TODAY, "r");
    const built = buildProviders(mergeRegistry(structuredClone(UPSTREAM) as Upstream, o), o);
    expect(built.providers.anthropic?.models["claude-haiku-4-5"]?.pricing.cache_write_1h).toBeNull();
    expect(built.providers.anthropic?.models["claude-opus-5-5"]?.pricing.cache_write_1h).toBe("8");
  });

  it("describes reasoning when the registry states reasoning facts for a model models.dev doesn't mark", () => {
    expect(catalogueModel("m", { reasoning: false, kaeso: { adaptive_thinking: true } }, "upstream").reasoning).toEqual({
      efforts: null,
      adaptive_thinking: true,
      thinking_binding: null,
    });
  });
});

describe("rules for some models", () => {
  it("apply only to model ids matching their pattern", () => {
    const files = REGISTRY.map((f) =>
      f.path === "registry/index.toml"
        ? { ...f, text: f.text.replace('provider = "anthropic"\nset', 'provider = "anthropic"\nmodels = "claude-opus-*"\nset') }
        : f,
    );
    const o = parseRegistry(files, TODAY, "r");
    const built = buildProviders(mergeRegistry(structuredClone(UPSTREAM) as Upstream, o), o);
    expect(built.providers.anthropic?.models["claude-opus-5-5"]?.pricing.cache_write_1h).toBe("8");
    expect(built.providers.anthropic?.models["claude-haiku-4-5"]?.pricing.cache_write_1h).toBeNull();
    expect(patternOf("anthropic/claude-*")("anthropic/claude-opus-4.6")).toBe(true);
    expect(patternOf("anthropic/claude-*")("openai/gpt-6")).toBe(false);
    expect(patternOf("a.b")("axb")).toBe(false);
  });
});
