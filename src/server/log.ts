export type Fields = Record<string, unknown>;

export interface Logger {
  info: (message: string, fields?: Fields) => void;
  warn: (message: string, fields?: Fields) => void;
  error: (message: string, fields?: Fields) => void;
}

export function jsonLogger(write: (line: string) => void, now: () => number): Logger {
  const line =
    (level: string) =>
    (message: string, fields: Fields = {}) =>
      write(`${JSON.stringify({ time: new Date(now()).toISOString(), level, message, ...fields })}\n`);
  return { info: line("info"), warn: line("warn"), error: line("error") };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
