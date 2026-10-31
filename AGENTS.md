# AGENTS.md

Rules for people and coding agents working on KPMR, the Kaeso Provider & Model Registry. What it is, how to run it and every setting are in [README.md](README.md); how to write a registry entry is in [registry/README.md](registry/README.md).

## What this repository is

- **Is:** the registry (`registry/`), reviewed like code, and the Node.js 24 service on `node:http` (`src/server`) that fetches models.dev, applies the registry and serves the signed catalogue Kaeso gateways read, plus the interface at kpmr.kaeso.app (`src/web`, React and `@logicplanes/kaeso-ui`).
- **Is not:** a place for Kaeso's code. What the gateway does with the catalogue lives in `logicplanes/kaeso` (`crates/kaeso-core/src/kpmr.rs`, `crates/kaeso-server/src/services/kpmr.rs`).
- **Is not:** a place for plans. Roadmaps, to-do lists and open questions go into issues.

## Layout

| Path                  | Holds                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `registry/index.toml` | The providers Kaeso calls and the pricing rules                                                                  |
| `registry/providers/` | One file per provider: corrections, additions and removals, each with its sources                                |
| `src/registry`        | The registry's schema and loader; every check that refuses an entry                                              |
| `src/shared`          | The catalogue format and the shapes of every endpoint, shared by the service and the interface                   |
| `src/server`          | models.dev fetch, merge, catalogue, signature, changes, state and the HTTP handler; `main.ts` is the entry point |
| `src/web`             | The interface: pages, router, the English, German and Chinese messages                                           |
| `scripts/`            | The registry check and the license check                                                                         |

## Definition of done

Every command passes before a change is complete:

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm licenses:check
```

For a registry change, also run `pnpm registry:check --upstream` and read its notes. For an interface change, look at every changed page in light and dark, at desktop and phone widths, in English, German and Chinese.

## Rules

1. **No code comments.** Names, types, small functions and tests explain the code; a registry entry explains itself in `note` and `sources`.
2. **The catalogue format is a contract.** `src/shared/catalogue.ts` is what Kaeso parses. Adding a field is fine; renaming, removing or retyping one is format 2, served next to format 1 until Kaeso has moved, and agreed with the Kaeso repository first. Every field is always present, unknown values are `null`, and prices are exact decimal strings.
3. **Every registry entry has a source** a reviewer can open: a provider's documentation, pricing page or changelog, or a live check described in `note` with its date. Never guess a price or a limit.
4. **models.dev stays the base.** Don't copy a whole model from models.dev into the registry; set only what differs. Remove an entry once models.dev has the same value (the registry notes say so).
5. **Every visible word in English, German and Simplified Chinese** (`src/web/i18n`), following Kaeso's translation rules: "Sie" in German, full-width punctuation in Chinese, names and ids never translated.
6. **The interface is built only from `@logicplanes/kaeso-ui`.** `className` is for layout only; see `node_modules/@logicplanes/kaeso-ui/AGENTS.md`.
7. **Tests for every change**, deterministic: fetch, clock and keys are injected and nothing touches the network. Coverage thresholds in `vitest.config.ts` are never lowered.
8. **pnpm only**, dependencies at exact versions and MIT-compatible.
9. **Never commit secrets.** The signing key lives only on the server.
10. **No leftovers.** Rename or remove a name, route, field or message everywhere in the same change.

## Git

- `main` takes changes through pull requests; the one required check is **CI**. The image build (`Dockerfile`) runs every check of the definition of done.
- Commit messages say what changed and why.
