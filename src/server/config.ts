import { readFileSync } from "node:fs";

export interface Config {
  port: number;
  dataDir: string;
  registryDir: string;
  webDir: string;
  origin: string;
  pollMs: number;
  modelsDevUrl: string;
  revision: string;
  signingKey: string | undefined;
  signingKeyId: string;
}

export type Env = Readonly<Record<string, string | undefined>>;

export const DEFAULTS = {
  port: 8080,
  dataDir: "/data",
  registryDir: ".",
  webDir: "dist/web",
  origin: "https://kpmr.kaeso.app",
  poll: "10m",
  modelsDevUrl: "https://models.dev/api.json",
  revision: "dev",
  signingKeyId: "kpmr-2026-10",
};

export const MIN_POLL_MS = 60_000;

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function parseDuration(value: string): number | null {
  const m = /^\s*(\d+)\s*(s|m|h)?\s*$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * (UNITS[m[2] ?? "s"] ?? 1000);
}

function signingKeyFile(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new ConfigError(`KPMR_SIGNING_KEY_FILE ${JSON.stringify(path)} cannot be read: ${(error as Error).message}`);
  }
}

const set = (value: string | undefined): string | undefined => (value === undefined || value.trim() === "" ? undefined : value.trim());

export function readConfig(env: Env): Config {
  const portText = set(env.PORT) ?? String(DEFAULTS.port);
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 1 || port > 65535) throw new ConfigError(`PORT must be a port number from 1 to 65535, not ${JSON.stringify(portText)}`);

  const pollText = set(env.KPMR_POLL) ?? DEFAULTS.poll;
  const pollMs = parseDuration(pollText);
  if (pollMs === null || pollMs < MIN_POLL_MS)
    throw new ConfigError(`KPMR_POLL must be a duration of at least 1m, such as 10m or 1h, not ${JSON.stringify(pollText)}`);

  const modelsDevUrl = set(env.KPMR_MODELS_DEV_URL) ?? DEFAULTS.modelsDevUrl;
  let url: URL;
  try {
    url = new URL(modelsDevUrl);
  } catch {
    throw new ConfigError(`KPMR_MODELS_DEV_URL must be an http or https address, not ${JSON.stringify(modelsDevUrl)}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new ConfigError(`KPMR_MODELS_DEV_URL must be an http or https address, not ${JSON.stringify(modelsDevUrl)}`);

  const origin = (set(env.KPMR_PUBLIC_URL) ?? DEFAULTS.origin).replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+$/.test(origin))
    throw new ConfigError(`KPMR_PUBLIC_URL must be an origin such as https://kpmr.kaeso.app, not ${JSON.stringify(origin)}`);

  const revision = set(env.KPMR_REVISION) ?? DEFAULTS.revision;
  if (!/^[\w.-]{1,64}$/.test(revision)) throw new ConfigError(`KPMR_REVISION must be a commit or a short name, not ${JSON.stringify(revision)}`);

  const keyId = set(env.KPMR_SIGNING_KEY_ID) ?? DEFAULTS.signingKeyId;
  if (!/^[\w.-]{1,64}$/.test(keyId)) throw new ConfigError(`KPMR_SIGNING_KEY_ID must be letters, digits, dots and hyphens, not ${JSON.stringify(keyId)}`);

  return {
    port,
    dataDir: set(env.KPMR_DATA) ?? DEFAULTS.dataDir,
    registryDir: set(env.KPMR_REGISTRY) ?? DEFAULTS.registryDir,
    webDir: set(env.KPMR_WEB) ?? DEFAULTS.webDir,
    origin,
    pollMs,
    modelsDevUrl,
    revision,
    signingKey: set(env.KPMR_SIGNING_KEY)?.replace(/\\n/g, "\n") ?? signingKeyFile(set(env.KPMR_SIGNING_KEY_FILE)),
    signingKeyId: keyId,
  };
}
