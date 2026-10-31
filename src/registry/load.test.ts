import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REGISTRY, TODAY } from "../server/test/fixtures.ts";
import { entryCount, loadRegistry, parseRegistry, type RegistryFile } from "./load.ts";
import { RegistryError } from "./schema.ts";

const SOURCE = '{ url = "https://example.com/a", checked = 2026-10-17 }';
const index = { path: "registry/index.toml", text: '[kaeso]\nproviders = ["openai"]\n' };
const problems = (files: RegistryFile[]): string[] => {
  try {
    parseRegistry(files, TODAY, "test");
  } catch (error) {
    if (error instanceof RegistryError) return error.problems;
    throw error;
  }
  return [];
};
const model = (body: string) => problems([index, { path: "registry/providers/openai.toml", text: `[models."m"]\n${body}\n` }]);

describe("the registry", () => {
  it("reads providers, models, rules and Kaeso's providers", () => {
    const overlay = parseRegistry(REGISTRY, TODAY, "abc123");
    expect(overlay.kaesoProviders).toEqual(["anthropic", "openai"]);
    expect(overlay.rules).toEqual([expect.objectContaining({ provider: "anthropic", set: "cost.cache_write_1h", multiply: 2 })]);
    expect(overlay.providers.get("example")?.action).toBe("add");
    const opus = overlay.models.get("anthropic")?.get("claude-opus-5-5");
    expect(opus?.sources).toEqual([{ url: "https://example.com/docs", checked: "2026-10-17" }]);
    expect(opus?.fields).toEqual({ kaeso: { adaptive_thinking: true, thinking_binding: true, forced_tool_choice: false }, limit: { output: 64000 } });
    expect(entryCount(overlay)).toBe(8);
  });

  it("loads from a folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "kpmr-registry-"));
    await mkdir(join(root, "registry/providers"), { recursive: true });
    for (const f of REGISTRY) await writeFile(join(root, f.path), f.text);
    const overlay = await loadRegistry(root, TODAY, "x");
    expect([...overlay.models.keys()].sort()).toEqual(["anthropic", "example"]);
  });

  it("requires sources with an https address and a past day", () => {
    expect(model('name = "x"')).toEqual([expect.stringContaining("must list at least one source")]);
    expect(model(`name = "x"\nsources = [{ url = "http://a.example", checked = 2026-10-01 }]`)).toEqual([expect.stringContaining("https address")]);
    expect(model(`name = "x"\nsources = [{ url = "https://a.example/x", checked = 2027-01-01 }]`)).toEqual([expect.stringContaining("in the future")]);
    expect(model(`name = "x"\nsources = [{ url = "https://a.example/x", checked = "yesterday" }]`)).toEqual([expect.stringContaining("YYYY-MM-DD")]);
    expect(model(`name = "x"\nsources = [{ url = "https://a.example/x", checked = 2026-10-01, by = "me" }]`)).toEqual([
      expect.stringContaining("by is not a field"),
    ]);
  });

  it("refuses unknown fields and wrong types, naming the file and the field", () => {
    expect(model(`sources = [${SOURCE}]\nprice = 3`)).toEqual([expect.stringMatching(/openai\.toml: models\."m"\.price is not a field KPMR knows/)]);
    expect(model(`sources = [${SOURCE}]\ncost = { input = -1 }`)).toEqual([expect.stringContaining("cost.input must be a price")]);
    expect(model(`sources = [${SOURCE}]\nlimit = { context = 1.5 }`)).toEqual([expect.stringContaining("whole number")]);
    expect(model(`sources = [${SOURCE}]\nmodalities = { input = ["smell"] }`)).toEqual([expect.stringContaining("must be one of text")]);
    expect(model(`sources = [${SOURCE}]\nkaeso = { efforts = ["high", "high"] }`)).toEqual([expect.stringContaining("lists a value twice")]);
    expect(model(`sources = [${SOURCE}]\nkaeso = { egress_dialect = "smtp" }`)).toEqual([expect.stringContaining("must be one of anthropic_messages")]);
    expect(model(`sources = [${SOURCE}]\nrelease_date = "October"`)).toEqual([expect.stringContaining("YYYY-MM")]);
    expect(model(`sources = [${SOURCE}]\ninterleaved = { field = "reasoning_content" }`)).toEqual([]);
  });

  it("checks what each action needs", () => {
    expect(model(`sources = [${SOURCE}]`)).toEqual([expect.stringContaining("changes nothing")]);
    expect(model(`action = "remove"\nsources = [${SOURCE}]`)).toEqual([expect.stringContaining("says why in note")]);
    expect(model(`action = "remove"\nnote = "x"\nname = "y"\nsources = [${SOURCE}]`)).toEqual([expect.stringContaining("sets no fields")]);
    expect(model(`action = "add"\nsources = [${SOURCE}]\nname = "y"`)).toEqual([
      expect.stringContaining("sets modalities"),
      expect.stringContaining("sets limit"),
      expect.stringContaining("sets cost"),
    ]);
    expect(model(`sources = [${SOURCE}]\ncost = { input = 5 }\nunset = ["cost.input"]`)).toEqual([expect.stringContaining("both sets and unsets cost.input")]);
    expect(model(`sources = [${SOURCE}]\nunset = ["cost.inptu"]`)).toEqual([expect.stringContaining("not a field path")]);
    expect(model(`sources = [${SOURCE}]\nunset = ["cost.context_over_200k.input", "limit.output"]`)).toEqual([]);
    expect(model(`sources = [${SOURCE}]\nunset = ["limit.output", "limit.output"]`)).toEqual([expect.stringContaining("lists a path twice")]);
    expect(
      problems([index, { path: "registry/providers/x1.toml", text: `[provider]\naction = "add"\nname = "X"\ndoc = "docs"\nsources = [${SOURCE}]` }]),
    ).toEqual([expect.stringContaining("doc must be an https address")]);
    expect(model(`action = "rename"\nsources = [${SOURCE}]\nname = "y"`)).toEqual([expect.stringContaining("action must be one of")]);
    expect(model(`sources = [${SOURCE}]\nunset = ["nothing.here"]`)).toEqual([expect.stringContaining("not a field path")]);
  });

  it("checks the index and the file layout", () => {
    expect(problems([{ path: "registry/providers/openai.toml", text: `[models."m"]\nname = "x"\nsources = [${SOURCE}]` }])).toContain(
      "registry/index.toml is missing",
    );
    expect(problems([{ path: "registry/index.toml", text: "[kaeso]\nproviders = []" }])).toEqual([expect.stringContaining("kaeso.providers must list")]);
    expect(problems([index, { path: "registry/openai.toml", text: "" }])).toEqual([expect.stringContaining("is not where registry files go")]);
    expect(problems([index, { path: "registry/providers/Open_AI.toml", text: `[provider]\nname = "x"\nsources = [${SOURCE}]` }])).toEqual([
      expect.stringContaining("is not a provider id"),
    ]);
    expect(problems([index, { path: "registry/providers/openai.toml", text: "[models\n" }])).toEqual([expect.stringContaining("openai.toml")]);
    expect(problems([index, { path: "registry/providers/openai.toml", text: "extra = 1" }])).toEqual([
      expect.stringContaining("extra is not a section"),
      expect.stringContaining("neither a provider nor models"),
    ]);
    expect(
      problems([
        {
          path: "registry/index.toml",
          text: `[kaeso]\nproviders = ["a1"]\n[[rules]]\nprovider = "a1"\nset = "cost.nope"\nfrom = "cost.input"\nmultiply = 0\nsources = [${SOURCE}]`,
        },
      ]),
    ).toEqual([expect.stringContaining("set must be a price path"), expect.stringContaining("multiply must be")]);
  });
});
