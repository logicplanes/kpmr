import type { RegistryFile } from "../../registry/load.ts";

export const TODAY = "2026-10-31";

export const UPSTREAM = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    env: ["ANTHROPIC_API_KEY"],
    npm: "@ai-sdk/anthropic",
    doc: "https://docs.anthropic.com/en/docs/about-claude/models",
    models: {
      "claude-opus-5-5": {
        id: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        family: "claude-opus",
        attachment: true,
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }],
        tool_call: true,
        structured_output: true,
        temperature: false,
        knowledge: "2026-06",
        release_date: "2026-09-22",
        last_updated: "2026-09-22",
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        open_weights: false,
        limit: { context: 1000000, output: 128000 },
        cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
      },
      "claude-haiku-4-5": {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        reasoning: true,
        tool_call: true,
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 200000, output: 64000 },
        cost: { input: 1, output: 5 },
        status: "deprecated",
      },
      "claude-broken": {
        id: "claude-broken",
        name: "A wrong entry",
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 1, output: 1 },
      },
    },
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    env: ["OPENAI_API_KEY"],
    models: {
      "text-embedding-3-small": {
        id: "text-embedding-3-small",
        name: "text-embedding-3-small",
        type: "embedding",
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 8191, output: 1536 },
        cost: { input: 0.02, output: 0 },
      },
    },
  },
};

const SOURCE = '{ url = "https://example.com/docs", checked = 2026-10-17 }';

export const REGISTRY: RegistryFile[] = [
  {
    path: "registry/index.toml",
    text: `[kaeso]
providers = ["openai", "anthropic"]

[[rules]]
provider = "anthropic"
set = "cost.cache_write_1h"
from = "cost.input"
multiply = 2
sources = [${SOURCE}]
`,
  },
  {
    path: "registry/providers/anthropic.toml",
    text: `[models."claude-opus-5-5"]
note = "No forced tool choice."
sources = [${SOURCE}]
kaeso = { adaptive_thinking = true, thinking_binding = true, forced_tool_choice = false }
limit = { output = 64000 }

[models."claude-haiku-4-5"]
sources = [${SOURCE}]
tool_call = true
unset = ["cost.output"]

[models."claude-broken"]
action = "remove"
note = "models.dev lists a model Anthropic never released."
sources = [${SOURCE}]

[models."claude-new"]
action = "add"
sources = [${SOURCE}]
name = "Claude New"
modalities = { input = ["text"], output = ["text"] }
limit = { context = 100000, output = 8000 }
cost = { input = 1.25, output = 5 }

[models."claude-gone"]
sources = [${SOURCE}]
name = "Not upstream"
`,
  },
  {
    path: "registry/providers/example.toml",
    text: `[provider]
action = "add"
name = "Example AI"
doc = "https://example.com"
sources = [${SOURCE}]

[models."example-1"]
action = "add"
sources = [${SOURCE}]
name = "Example 1"
modalities = { input = ["text"], output = ["text"] }
limit = { context = 32000, output = 4000 }
cost = { input = 0.5, output = 1.5 }
`,
  },
];
