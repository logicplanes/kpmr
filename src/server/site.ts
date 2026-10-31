import { de } from "../web/i18n/de.ts";
import { en, type MessageKey, type Messages } from "../web/i18n/en.ts";
import { zhCN } from "../web/i18n/zh-CN.ts";
import type { Service } from "./service.ts";

export const LOCALES = ["en", "de", "zh-CN"] as const;
export type Locale = (typeof LOCALES)[number];

const CATALOGS: Record<Locale, Messages> = { en, de, "zh-CN": zhCN };
const OG_LOCALES: Record<Locale, string> = { en: "en_US", de: "de_DE", "zh-CN": "zh_CN" };

export function text(locale: Locale, key: MessageKey, values: Record<string, string | number> = {}): string {
  return CATALOGS[locale][key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

export type PageRoute =
  { page: "overview" | "providers" | "changes" | "format" } | { page: "provider"; provider: string } | { page: "model"; provider: string; model: string };

export type Resolved = { kind: "redirect"; location: string } | { kind: "page"; status: 200 | 404; locale: Locale; path: string; route: PageRoute | null };

export function safeDecode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

export function localePath(locale: Locale, path: string): string {
  const prefix = locale === "en" ? "" : `/${locale}`;
  return path === "/" ? prefix || "/" : `${prefix}${path}`;
}

export const providerPath = (provider: string) => `/providers/${encodeURIComponent(provider)}`;
export const modelPath = (provider: string, model: string) => `/models/${encodeURIComponent(provider)}/${model.split("/").map(encodeURIComponent).join("/")}`;

export function resolvePage(pathname: string, search: string, service: Service): Resolved {
  if (pathname === "/en" || pathname.startsWith("/en/")) return { kind: "redirect", location: (pathname.slice(3) || "/") + search };
  if (pathname.length > 1 && pathname.endsWith("/")) return { kind: "redirect", location: pathname.replace(/\/+$/, "") + search };
  const raw = pathname.split("/").filter(Boolean);
  const decoded = raw.map(safeDecode);
  const locale: Locale = decoded[0] === "de" || decoded[0] === "zh-CN" ? decoded[0] : "en";
  const parts = locale === "en" ? decoded : decoded.slice(1);
  const rest = locale === "en" ? raw : raw.slice(1);
  const path = `/${rest.join("/")}`.replace(/\/$/, "") || "/";
  const missing = { kind: "page" as const, status: 404 as const, locale, path, route: null };
  if (parts.some((p) => p === null)) return missing;
  const [first, second, ...more] = parts as string[];
  const ready = service.ready();
  if (!first) return { kind: "page", status: 200, locale, path, route: { page: "overview" } };
  if ((first === "providers" || first === "changes" || first === "format") && !second)
    return { kind: "page", status: 200, locale, path, route: { page: first } };
  if (first === "providers" && second && more.length === 0) {
    if (ready && !service.provider(second)) return missing;
    return { kind: "page", status: 200, locale, path, route: { page: "provider", provider: second } };
  }
  if (first === "models" && second && more.length > 0) {
    const model = more.join("/");
    if (ready && !service.model(second, model)) return missing;
    return { kind: "page", status: 200, locale, path, route: { page: "model", provider: second, model } };
  }
  return missing;
}

export interface Head {
  title: string;
  description: string;
  indexed: boolean;
}

export function headFor(resolved: Extract<Resolved, { kind: "page" }>, service: Service): Head {
  const { locale, route } = resolved;
  const t = (key: MessageKey, values?: Record<string, string | number>) => text(locale, key, values);
  const page = (name: string) => t("title.page", { page: name });
  if (!route || resolved.status === 404) return { title: page(t("common.notFound")), description: t("common.notFoundHint"), indexed: false };
  switch (route.page) {
    case "overview":
      return { title: t("seo.overview.title"), description: t("seo.overview.description"), indexed: true };
    case "providers":
      return { title: page(t("providers.title")), description: t("seo.providers.description"), indexed: true };
    case "changes":
      return { title: page(t("changes.title")), description: t("seo.changes.description"), indexed: true };
    case "format":
      return { title: page(t("format.title")), description: t("seo.format.description"), indexed: true };
    case "provider": {
      const view = service.provider(route.provider);
      const name = view?.provider.name ?? route.provider;
      return { title: page(name), description: t("seo.provider.description", { provider: name, count: view?.models.length ?? 0 }), indexed: true };
    }
    case "model": {
      const view = service.model(route.provider, route.model);
      const name = view?.model.name ?? route.model;
      const provider = view?.provider.name ?? route.provider;
      return { title: page(`${name} · ${provider}`), description: t("seo.model.description", { model: name, provider }), indexed: true };
    }
  }
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderHead(html: string, origin: string, resolved: Extract<Resolved, { kind: "page" }>, head: Head): string {
  const url = (locale: Locale) => `${origin}${localePath(locale, resolved.path)}`;
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="KPMR" />`,
    `<meta property="og:title" content="${escape(head.title)}" />`,
    `<meta property="og:description" content="${escape(head.description)}" />`,
    `<meta property="og:image" content="${origin}/og.png" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="Kaeso KPMR" />`,
    `<meta property="og:locale" content="${OG_LOCALES[resolved.locale]}" />`,
    ...LOCALES.filter((l) => l !== resolved.locale).map((l) => `<meta property="og:locale:alternate" content="${OG_LOCALES[l]}" />`),
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escape(head.title)}" />`,
    `<meta name="twitter:description" content="${escape(head.description)}" />`,
    `<meta name="twitter:image" content="${origin}/og.png" />`,
    ...(head.indexed
      ? [
          `<link rel="canonical" href="${escape(url(resolved.locale))}" />`,
          `<meta property="og:url" content="${escape(url(resolved.locale))}" />`,
          ...LOCALES.map((l) => `<link rel="alternate" hreflang="${l}" href="${escape(url(l))}" />`),
          `<link rel="alternate" hreflang="x-default" href="${escape(url("en"))}" />`,
        ]
      : [`<meta name="robots" content="noindex" />`]),
  ];
  return html
    .replace(/<html lang="[^"]*"/, `<html lang="${resolved.locale}"`)
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(head.title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/>/, `<meta name="description" content="${escape(head.description)}" />`)
    .replace("</head>", `    ${tags.join("\n    ")}\n  </head>`);
}

export function sitemap(origin: string, service: Service): string {
  const paths = ["/", "/providers", "/changes", "/format"];
  const meta = service.meta();
  for (const p of service.providerList() ?? []) {
    paths.push(providerPath(p.id));
    if (meta?.kaeso_providers.includes(p.id)) for (const m of service.provider(p.id)?.models ?? []) paths.push(modelPath(p.id, m.id));
  }
  const entry = (path: string) =>
    LOCALES.map(
      (l) =>
        `<url><loc>${escape(origin + localePath(l, path))}</loc>${LOCALES.map((a) => `<xhtml:link rel="alternate" hreflang="${a}" href="${escape(origin + localePath(a, path))}"/>`).join("")}</url>`,
    ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${paths.map(entry).join("")}</urlset>\n`;
}

export function llms(origin: string, service: Service): string {
  const meta = service.meta();
  const lines = [
    "# KPMR, the Kaeso Provider & Model Registry",
    "",
    `> ${en["seo.overview.description"]}`,
    "",
    "KPMR fetches models.dev every 10 minutes, applies a reviewed registry of corrections, additions and removals (each with sources), and serves Kaeso gateways a signed catalogue in Kaeso's own format.",
    "",
    "## Data",
    "",
    `- [Catalogue](${origin}/v1/catalogue): the signed catalogue, \`application/vnd.kaeso.kpmr+json; version=1\`; \`?providers=a,b\` for some providers`,
    `- [Catalogue format](${origin}/format): the format, the request and response, and signature verification`,
    `- [Providers](${origin}/v1/providers.json), [one provider](${origin}/v1/providers/anthropic.json), [one model](${origin}/v1/models/anthropic/claude-sonnet-5-5.json)`,
    `- [Changes](${origin}/v1/changes.json), [metadata](${origin}/v1/meta.json), [public keys](${origin}/v1/keys.json)`,
    "",
    "## Source",
    "",
    "- [logicplanes/kpmr](https://github.com/logicplanes/kpmr): the registry and the service, MIT",
    `- [Licenses](${origin}/licenses.txt): KPMR's and models.dev's (MIT)`,
    "- [Kaeso](https://kaeso.app), [documentation](https://docs.kaeso.app)",
  ];
  if (meta) lines.push("", `Current revision: ${meta.revision}; ${meta.catalogue.providers} providers, ${meta.catalogue.models} models.`);
  return `${lines.join("\n")}\n`;
}
