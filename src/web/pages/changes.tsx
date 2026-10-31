import { useState } from "react";
import { Badge, Empty, Segmented, Text, Timeline, type TimelineEvent } from "@logicplanes/kaeso-ui";
import { formatNumber, formatRelative } from "@logicplanes/kaeso-ui/format";
import { HeaderTitle } from "../cells.tsx";
import { HeaderLinks } from "./overview.tsx";
import type { Change } from "../../shared/catalogue.ts";
import { useJson } from "../data.ts";
import { useI18n, type Locale, type Translate } from "../i18n/index.ts";
import { Page, whenReady } from "../page.tsx";
import { href, modelPath, RouterLink } from "../router.tsx";

const SHOWN_FIELDS = 4;

const show = (value: unknown): string => (value === null || value === undefined ? "–" : Array.isArray(value) ? value.join(", ") || "–" : String(value));

export function changeEvent(c: Change, index: number, t: Translate, locale: Locale): TimelineEvent {
  const label = `${c.provider} / ${c.model}`;
  const title =
    c.kind === "added"
      ? t("changes.added", { model: label })
      : c.kind === "removed"
        ? t("changes.removed", { model: label })
        : t("changes.changed", { model: label });
  const lines = c.fields.slice(0, SHOWN_FIELDS).map((f) => t("changes.field", { field: f.path, before: show(f.before), after: show(f.after) }));
  if (c.fields.length > SHOWN_FIELDS) lines.push(t("changes.more", { count: c.fields.length - SHOWN_FIELDS }));
  return {
    id: `${c.at}-${c.provider}-${c.model}-${index}`,
    title: c.kind === "removed" ? title : <RouterLink href={href(locale, modelPath(c.provider, c.model))}>{title}</RouterLink>,
    description: (
      <span className="flex flex-col gap-4">
        <span>
          <Badge tone={c.cause === "registry" ? "info" : "neutral"}>{t(`changes.cause.${c.cause}`)}</Badge>
        </span>
        {lines.map((line) => (
          <Text key={line} variant="small" tone="secondary" mono>
            {line}
          </Text>
        ))}
      </span>
    ),
    time: formatRelative(c.at),
    datetime: c.at,
    tone: c.kind === "removed" ? "danger" : c.kind === "added" ? "success" : undefined,
  };
}

export function ChangesPage() {
  const { t, locale } = useI18n();
  const [cause, setCause] = useState("all");
  const changes = useJson<Change[]>("/v1/changes.json?limit=500");
  return (
    <Page
      title={<HeaderTitle title={t("changes.title")} count={changes.state === "ready" ? formatNumber(changes.data.length) : undefined} />}
      documentTitle={t("changes.title")}
      actions={<HeaderLinks meta={null} />}
    >
      <div className="flex max-w-800 flex-col gap-24">
        <Text tone="secondary">{t("changes.lead")}</Text>
        <Segmented
          aria-label={t("changes.cause")}
          size="sm"
          value={cause}
          onValueChange={setCause}
          options={(["all", "models_dev", "registry"] as const).map((v) => ({ value: v, label: t(`changes.cause.${v}`) }))}
        />
        {whenReady(changes, (list) => {
          const shown = cause === "all" ? list : list.filter((c) => c.cause === cause);
          if (shown.length === 0) return <Empty size="md" title={t("changes.none")} description={t("changes.noneHint")} />;
          return <Timeline events={shown.map((c, i) => changeEvent(c, i, t, locale))} />;
        })}
      </div>
    </Page>
  );
}
