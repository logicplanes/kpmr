import { loadRegistry, entryCount } from "../src/registry/load.ts";
import { RegistryError } from "../src/registry/schema.ts";
import { mergeRegistry } from "../src/server/merge.ts";
import { fetchUpstream, parseUpstream } from "../src/server/upstream.ts";

const today = new Date().toISOString().slice(0, 10);
const withUpstream = process.argv.includes("--upstream");

try {
  const overlay = await loadRegistry(process.cwd(), today, "check");
  let models = 0;
  for (const m of overlay.models.values()) models += m.size;
  process.stdout.write(
    `registry: ${entryCount(overlay)} entries (${overlay.providers.size} providers, ${models} models, ${overlay.rules.length} rules) are valid\n`,
  );
  if (withUpstream) {
    const fetched = await fetchUpstream(fetch, "https://models.dev/api.json", null);
    if (fetched.kind !== "body") throw new Error("models.dev sent no body");
    const { notes } = mergeRegistry(parseUpstream(fetched.bytes), overlay);
    for (const n of notes)
      process.stdout.write(`note: ${n.file}: ${n.provider}${n.model ? `/${n.model}` : ""}: ${n.kind}${n.fields.length ? ` (${n.fields.join(", ")})` : ""}\n`);
    process.stdout.write(`models.dev: ${notes.length} notes\n`);
  }
} catch (error) {
  if (error instanceof RegistryError) {
    for (const p of error.problems) process.stderr.write(`${p}\n`);
    process.stderr.write(`registry: ${error.problems.length} problems\n`);
  } else process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
}
