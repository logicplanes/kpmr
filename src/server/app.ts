import { createServer, type Server } from "node:http";
import { loadRegistry } from "../registry/load.ts";
import { readConfig, type Env } from "./config.ts";
import { createHandler } from "./http.ts";
import { errorMessage, type Logger } from "./log.ts";
import { Service, type Clock } from "./service.ts";
import type { Fetch } from "./upstream.ts";

export interface AppOptions {
  env: Env;
  fetch: Fetch;
  clock: Clock;
  log: Logger;
}

export interface App {
  server: Server;
  service: Service;
  close: () => Promise<void>;
}

export async function startApp({ env, fetch, clock, log }: AppOptions): Promise<App> {
  const config = readConfig(env);
  const today = new Date(clock.now()).toISOString().slice(0, 10);
  const overlay = await loadRegistry(config.registryDir, today, config.revision);
  const service = new Service({
    dataDir: config.dataDir,
    overlay,
    modelsDevUrl: config.modelsDevUrl,
    fetch,
    clock,
    log,
    signingKey: config.signingKey,
    signingKeyId: config.signingKeyId,
  });
  await service.start();
  const handler = createHandler(service, { webDir: config.webDir, onError: (error) => log.error("request failed", { error: errorMessage(error) }) });
  const server = createServer((req, res) => void handler(req, res));
  server.keepAliveTimeout = 65_000;
  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  log.info("listening", { port: config.port, revision: config.revision, ready: service.ready() });
  service.schedule(config.pollMs);
  return {
    server,
    service,
    close: async () => {
      await service.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
