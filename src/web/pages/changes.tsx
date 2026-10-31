import { useMemo, useState } from "react";
import { Badge, Empty, List, ProviderBadge, SearchInput, Segmented, Text, Toolbar, type ListGroup } from "@logicplanes/kaeso-ui";
import { formatContext, formatDate, formatNumber, formatPrice } from "@logicplanes/kaeso-ui/format";
import type { Change } from "../../shared/catalogue.ts";
import { HeaderTitle } from "../cells.tsx";
import { useJson } from "../data.ts";
import { useI18n, type MessageKey, type Translate } from "../i18n/index.ts";
import { en } from "../i18n/en.ts";
import { Page } from "../page.tsx";
import { href, modelPath, navigate } from "../router.tsx";
import { HeaderLinks } from "./overview.tsx";

const SHOWN = 3;
const TONE = { added: "success", removed: "danger", changed: "neutral" } as const;

export function fieldLabel(path: string, t: Translate): string {
  const key = `field.${path}`;
  if (key in en) return t(key as MessageKey);
  const parent = path.slice(0, path.lastIndexOf("."));
  return `field.${parent}` in en ? `${t(`field.${parent}` as MessageKey)}, ${path.slice(parent.length + 1)}` : path;
}

export function fieldValue(path: string, value: unknown, t: Translate): string {
  if (value === null || value === undefined) return "–";
  if (path.startsWith("pricing.") && typeof value === "string" && /^\d/.test(value)) return formatPrice(value);
  if (path.startsWith("limits.") && typeof value === "number") return formatContext(value);
  if (typeof value === "boolean") return value ? t("model.yes") : t("model.no");
  if (Array.isArray(value)) return value.length ? value.join(", ") : t("model.none");
  return String(value);
}

export function changeSummary(c: Change, t: Translate): string {
  const parts = c.fields.slice(0, SHOWN).map((f) => `${fieldLabel(f.path, t)}: ${fieldValue(f.path, f.before, t)} → ${fieldValue(f.path, f.after, t)}`);
  if (c.fields.length > SHOWN) parts.push(t("changes.more", { count: c.fields.length - SHOWN }));
  return parts.join(" · ");
}

export function ChangesPage() {
  const { t, locale } = useI18n();
  const [cause, setCause] = useState("all");
  const [query, setQuery] = useState("");
  const changes = useJson<Change[]>("/v1/changes.json?limit=2000");
  const all = changes.state === "ready" ? changes.data : [];
  const groups = useMemo((): ListGroup[] => {
    const q = query.trim().toLowerCase();
    const shown = all.filter((c) => (cause === "all" || c.cause === cause) && (!q || `${c.provider}/${c.model}`.toLowerCase().includes(q)));
    const byDay = new Map<string, { change: Change; index: number }[]>();
    shown.forEach((change, index) => {
      const day = change.at.slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), { change, index }]);
    });
    return [...byDay].map(([day, rows]) => ({
      id: day,
      title: formatDate(`${day}T12:00:00Z`),
      count: rows.length,
      items: rows.map(({ change: c, index }) => ({
        id: `${index}`,
        title: (
          <Text mono truncate>
            {c.model}
          </Text>
        ),
        textValue: `${c.provider} ${c.model}`,
        leading: <ProviderBadge provider={c.provider} size="sm" />,
        subtitle: c.kind === "changed" ? changeSummary(c, t) : c.provider,
        meta: (
          <span className="flex items-center gap-8">
            <Badge tone={TONE[c.kind]}>{t(`changes.kind.${c.kind}`)}</Badge>
            <Badge tone="outline">{t(`changes.cause.${c.cause}`)}</Badge>
          </span>
        ),
        date: new Date(c.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
      })),
    }));
  }, [all, cause, query, t, locale]);
  const rows = new Map(all.map((c, i) => [`${i}`, c]));
  return (
    <Page
      title={<HeaderTitle title={t("changes.title")} count={changes.state === "ready" ? formatNumber(all.length) : undefined} />}
      documentTitle={t("changes.title")}
      padding="none"
      actions={<HeaderLinks meta={null} />}
    >
      <Toolbar aria-label={t("changes.cause")}>
        <Segmented
          aria-label={t("changes.cause")}
          size="sm"
          value={cause}
          onValueChange={setCause}
          options={(["all", "models_dev", "registry"] as const).map((v) => ({ value: v, label: t(`changes.cause.${v}`) }))}
        />
        <SearchInput
          aria-label={t("changes.search")}
          placeholder={t("changes.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
        />
      </Toolbar>
      <List
        aria-label={t("changes.title")}
        groups={groups}
        loading={changes.state === "loading"}
        wrapSubtitle
        onOpen={(item) => {
          const c = rows.get(item.id);
          if (c && c.kind !== "removed") navigate(href(locale, modelPath(c.provider, c.model)));
        }}
        empty={
          <Empty
            size="compact"
            title={all.length === 0 ? t("changes.none") : t("changes.noMatch")}
            description={all.length === 0 ? t("changes.noneHint") : t("changes.noMatchHint")}
          />
        }
      />
    </Page>
  );
}
