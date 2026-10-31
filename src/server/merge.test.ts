import { describe, expect, it } from "vitest";
import { parseRegistry } from "../registry/load.ts";
import { equal, fieldOrigins, merge, mergeRegistry, type Upstream } from "./merge.ts";
import { REGISTRY, TODAY, UPSTREAM } from "./test/fixtures.ts";

const overlay = parseRegistry(REGISTRY, TODAY, "r1");
const upstream = () => structuredClone(UPSTREAM) as unknown as Upstream;

describe("merging the registry over models.dev", () => {
  it("patches, unsets, adds and removes, and keeps models.dev intact", () => {
    const source = upstream();
    const merged = mergeRegistry(source, overlay);
    const models = merged.document.anthropic?.models as Record<string, Record<string, unknown>>;
    expect(Object.keys(models)).toEqual(["claude-haiku-4-5", "claude-new", "claude-opus-5-5"]);
    expect(models["claude-opus-5-5"]?.limit).toEqual({ context: 1000000, output: 64000 });
    expect(models["claude-opus-5-5"]?.kaeso).toEqual({ adaptive_thinking: true, thinking_binding: true, forced_tool_choice: false });
    expect(models["claude-haiku-4-5"]?.cost).toEqual({ input: 1 });
    expect(models["claude-new"]).toMatchObject({ id: "claude-new", name: "Claude New" });
    expect(merged.origins.get("anthropic")?.get("claude-new")).toBe("added");
    expect(merged.origins.get("anthropic")?.get("claude-opus-5-5")).toBe("patched");
    expect(merged.document.example).toMatchObject({ id: "example", name: "Example AI" });
    expect(source).toEqual(UPSTREAM);
  });

  it("notes entries that change nothing", () => {
    const { notes } = mergeRegistry(upstream(), overlay);
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "redundant", model: "claude-haiku-4-5", fields: ["tool_call"] }),
        expect.objectContaining({ kind: "not-upstream", model: "claude-gone" }),
      ]),
    );
    const listed = upstream();
    (listed.anthropic?.models as Record<string, unknown>)["claude-new"] = { id: "claude-new", name: "Claude New" };
    expect(mergeRegistry(listed, overlay).notes).toContainEqual(expect.objectContaining({ kind: "listed-upstream", model: "claude-new" }));
    const gone = upstream();
    delete gone.anthropic;
    expect(mergeRegistry(gone, overlay).notes).toContainEqual(
      expect.objectContaining({ kind: "provider-not-upstream", provider: "anthropic", model: "claude-opus-5-5" }),
    );
  });

  it("merges objects deeply and replaces lists", () => {
    expect(merge({ a: { b: 1, c: [1, 2] } }, { a: { c: [3] } })).toEqual({ a: { b: 1, c: [3] } });
    expect(equal({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(equal({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("says where each field comes from", () => {
    const entry = overlay.models.get("anthropic")?.get("claude-opus-5-5");
    const origins = fieldOrigins({ id: "x", name: "n", limit: { context: 1, output: 2 } }, entry, "patched");
    expect(origins).toEqual({ name: "upstream", "limit.context": "upstream", "limit.output": "kpmr" });
    expect(fieldOrigins({ name: "n" }, undefined, "added")).toEqual({ name: "kpmr" });
  });
});
