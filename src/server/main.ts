import { startApp } from "./app.ts";
import { errorMessage, jsonLogger } from "./log.ts";
import { systemClock } from "./service.ts";

const log = jsonLogger((line) => process.stdout.write(line), Date.now);

try {
  const app = await startApp({ env: process.env, fetch, clock: systemClock, log });
  const stop = (signal: string) => {
    log.info("stopping", { signal });
    setTimeout(() => process.exit(1), 10_000).unref();
    void app.close().then(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
} catch (error) {
  log.error("not started", { error: errorMessage(error) });
  process.exitCode = 1;
}
