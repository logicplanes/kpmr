# The registry

Everything KPMR changes about models.dev lives here, one file per provider in `providers/<provider id>.toml`, plus `index.toml`. `pnpm registry:check` checks every file; `pnpm registry:check --upstream` also compares them with models.dev as it is now and lists entries that no longer change anything.

## A correction

Set only the fields that differ from models.dev. Objects merge, lists replace:

```toml
[models."claude-opus-5-5"]
note = "Forced tool choice returns 400 tool_choice: type \"tool\" and \"any\" are not supported for this model. Live check 2026-10-17."
sources = [
  { url = "https://platform.claude.com/docs/en/about-claude/models/migration-guide", checked = 2026-10-17 },
]
limit = { output = 64000 }
kaeso = { forced_tool_choice = false }
```

`unset = ["cost.cache_write"]` removes a value models.dev has that is wrong, so the catalogue says `null` (unknown) instead.

## A model models.dev doesn't have

```toml
[models."example-large-2"]
action = "add"
sources = [{ url = "https://example.com/models", checked = 2026-10-31 }]
name = "Example Large 2"
modalities = { input = ["text", "image"], output = ["text"] }
limit = { context = 256000, output = 32000 }
cost = { input = 2, output = 8 }
tool_call = true
```

A new provider adds a `[provider]` table with `action = "add"`, `name` and its `sources`, and optionally `doc`, `api`, `env` and `npm`.

## A wrong model

```toml
[models."example-typo"]
action = "remove"
note = "models.dev lists a model id the provider never served; requests to it answer 404."
sources = [{ url = "https://example.com/models", checked = 2026-10-31 }]
```

## Fields

The fields are models.dev's: `name`, `description`, `family`, `type`, `status` (`alpha`, `beta`, `deprecated`), `experimental`, `release_date`, `last_updated`, `knowledge`, `open_weights`, `attachment`, `reasoning`, `reasoning_options`, `tool_call`, `structured_output`, `temperature`, `interleaved`, `modalities.input` and `.output`, `limit.context`, `.input` and `.output`, `cost.input`, `.output`, `.cache_read`, `.cache_write`, `.cache_write_1h`, `.reasoning`, `.input_audio`, `.output_audio` and `.context_over_200k`, in USD per million tokens, `canonical_model_id` and `provider`.

`kaeso` holds what only a gateway needs:

| Field                      | Catalogue                         | Meaning                                                |
| -------------------------- | --------------------------------- | ------------------------------------------------------ |
| `kaeso.adaptive_thinking`  | `reasoning.adaptive_thinking`     | The model accepts adaptive thinking                    |
| `kaeso.thinking_binding`   | `reasoning.thinking_binding`      | Thinking blocks must stay with the turn they belong to |
| `kaeso.efforts`            | `reasoning.efforts`               | The effort levels the model accepts; `[]` for none     |
| `kaeso.forced_tool_choice` | `capabilities.forced_tool_choice` | Whether `tool_choice` may force a tool                 |
| `kaeso.egress_dialect`     | `gateway.egress_dialect`          | The API a gateway sends the model's requests through   |

## Sources

Every entry needs `sources`, each `{ url = "https://…", checked = YYYY-MM-DD }` with an optional `note`: the provider's documentation, pricing page, changelog or model list, opened on that day. A live check goes into `note` with what was sent, what came back and when. A reviewer must be able to open every source and find the value.

## Rules

`index.toml` lists the providers Kaeso calls (`[kaeso] providers`) and pricing rules that set one price from another for every model of a provider, each with its sources:

```toml
[[rules]]
provider = "anthropic"
set = "cost.cache_write_1h"
from = "cost.input"
multiply = 2
sources = [{ url = "https://platform.claude.com/docs/en/about-claude/pricing", checked = 2026-10-19 }]
```

A rule never overwrites a price models.dev or an entry already sets.
