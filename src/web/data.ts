import { useEffect, useState } from "react";

export type Loaded<T> = { state: "loading" } | { state: "error"; retry: () => void } | { state: "missing" } | { state: "ready"; data: T };

const cache = new Map<string, Promise<unknown>>();

export function load<T>(url: string): Promise<T> {
  let request = cache.get(url) as Promise<T> | undefined;
  if (!request) {
    request = fetch(url, { headers: { accept: "application/json" } }).then(async (r) => {
      if (r.status === 404) throw new Missing();
      if (!r.ok) throw new Error(`${url} answered ${r.status}`);
      return (await r.json()) as T;
    });
    cache.set(url, request);
    request.catch(() => cache.delete(url));
  }
  return request;
}

export class Missing extends Error {}

export function useJson<T>(url: string): Loaded<T> {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ url: string; value: Loaded<T> }>({ url, value: { state: "loading" } });
  useEffect(() => {
    let live = true;
    load<T>(url).then(
      (data) => live && setResult({ url, value: { state: "ready", data } }),
      (error: unknown) =>
        live && setResult({ url, value: error instanceof Missing ? { state: "missing" } : { state: "error", retry: () => setAttempt((n) => n + 1) } }),
    );
    return () => {
      live = false;
    };
  }, [url, attempt]);
  return result.url === url ? result.value : { state: "loading" };
}
