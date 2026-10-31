import { useMemo, useState } from "react";
import {
  Badge,
  DataTable,
  Empty,
  Heading,
  Link,
  ModelLabel,
  ProviderBadge,
  SearchInput,
  Segmented,
  Text,
  Toolbar,
  col,
  type Capability,
} from "@logicplanes/kaeso-ui";
import { formatContext, formatNumber } from "@logicplanes/kaeso-ui/format";
import type { ModelSummary, ProviderView } from "../../shared/catalogue.ts";
import { useJson } from "../data.ts";
import { Cell, Cells, HeaderTitle, Metric } from "../cells.tsx";
import { HeaderLinks } from "./overview.tsx";
import { useI18n } from "../i18n/index.ts";
import { Missing, Page, price, whenReady } from "../page.tsx";
import { href, modelPath, navigate } from "../router.tsx";

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function ProviderPage({ id }: { id: string }) {
  const { t } = useI18n();
  const view = useJson<ProviderView>(`/v1/providers/${encodeURIComponent(id)}.json`);
  const name = view.state === "ready" ? view.data.provider.name : id;
  return (
    <Page
      title={<HeaderTitle title={name} count={view.state === "ready" ? formatNumber(view.data.models.length) : undefined} />}
      documentTitle={name}
      padding="none"
      actions={<HeaderLinks meta={null} />}
    >
      {whenReady(
        view,
        (v) => (
          <Provider view={v} />
        ),
        <div className="p-24">
          <Missing title={t("provider.notFound")} description={t("provider.notFoundHint", { id })} />
        </div>,
      )}
    </Page>
  );
}

function Provider({ view }: { view: ProviderView }) {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const p = view.provider;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return view.models
      .filter((m) => filter === "all" || (filter === "added" ? m.origin === "kpmr" : m.corrected > 0 && m.origin === "models_dev"))
      .filter((m) => !q || m.id.toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q));
  }, [view.models, filter, query]);
  const unknown = t("model.unknown");
  const columns = [
    col.custom(
      { id: "model", header: t("provider.model"), size: 360, grow: true, priority: 1 },
      (m: ModelSummary) => m.name ?? m.id,
      (_v: string, m) => (
        <ModelLabel
          provider={p.id}
          providerName={p.name}
          model={m.id}
          name={m.name ?? undefined}
          capabilities={m.capabilities as Capability[]}
          mark={false}
          stacked
        />
      ),
    ),
    col.custom(
      { id: "context", header: t("provider.context"), size: 104, priority: 2 },
      (m: ModelSummary) => m.context ?? -1,
      (v: number) => (v < 0 ? unknown : formatContext(v)),
      { align: "end" },
    ),
    col.custom(
      { id: "output", header: t("provider.output"), size: 96, priority: 3 },
      (m: ModelSummary) => m.output ?? -1,
      (v: number) => (v < 0 ? unknown : formatContext(v)),
      { align: "end" },
    ),
    col.custom(
      { id: "input-price", header: t("provider.input"), size: 104, priority: 2 },
      (m: ModelSummary) => m.input_price,
      (v) => price(v, unknown),
      { align: "end" },
    ),
    col.custom(
      { id: "output-price", header: t("provider.outputPrice"), size: 104, priority: 3 },
      (m: ModelSummary) => m.output_price,
      (v) => price(v, unknown),
      { align: "end" },
    ),
    col.custom(
      { id: "kpmr", header: t("provider.kpmr"), size: 168, priority: 2 },
      (m: ModelSummary) => (m.origin === "kpmr" ? 2 : m.corrected > 0 ? 1 : 0),
      (v: number, m) => (
        <span className="flex items-center gap-4">
          {v === 2 && <Badge tone="info">{t("origin.kpmr")}</Badge>}
          {v === 1 && <Badge tone="outline">{t("origin.corrected")}</Badge>}
          {m.status !== "active" && <Badge tone={m.status === "deprecated" ? "warning" : "neutral"}>{t(`status.${m.status}`)}</Badge>}
        </span>
      ),
    ),
  ];
  return (
    <>
      <div className="flex items-center gap-16 px-24 pt-40 pb-32 hairline-b-strong">
        <ProviderBadge provider={p.id} name={p.name} size="xl" />
        <span className="flex min-w-0 flex-col gap-4">
          <Heading level={1} size="title-lg">
            {p.name}
          </Heading>
          <span className="flex flex-wrap items-center gap-8">
            <Text tone="tertiary" mono>
              {p.id}
            </Text>
            {view.kaeso && <Badge tone="success">{t("provider.usedByKaeso")}</Badge>}
            {p.origin === "kpmr" && <Badge tone="info">{t("origin.kpmr")}</Badge>}
          </span>
        </span>
      </div>
      <Cells columns={4}>
        <Metric label={t("overview.stat.models")} value={formatNumber(view.models.length)} />
        <Metric label={t("overview.stat.corrected")} value={formatNumber(view.models.filter((m) => m.origin === "models_dev" && m.corrected > 0).length)} />
        <Cell>
          <Text variant="small" tone="secondary">
            {t("provider.env")}
          </Text>
          <Text mono truncate>
            {p.env.length ? p.env.join(", ") : t("model.none")}
          </Text>
        </Cell>
        <Cell>
          <Text variant="small" tone="secondary">
            {t("provider.docs")}
          </Text>
          {p.docs_url ? (
            <Link href={p.docs_url} external>
              {hostOf(p.docs_url)}
            </Link>
          ) : (
            <Text tone="tertiary">{unknown}</Text>
          )}
        </Cell>
      </Cells>
      <Toolbar aria-label={t("provider.filter")}>
        <Segmented
          aria-label={t("provider.filter")}
          size="sm"
          value={filter}
          onValueChange={setFilter}
          options={(["all", "corrected", "added"] as const).map((v) => ({ value: v, label: t(`provider.filter.${v}`) }))}
        />
        <SearchInput
          aria-label={t("provider.search")}
          placeholder={t("provider.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
        />
      </Toolbar>
      <DataTable
        aria-label={t("providers.models")}
        data={rows}
        columns={columns}
        getRowId={(m) => m.id}
        density="comfortable"
        virtualizeAbove={60}
        onRowClick={(m) => navigate(href(locale, modelPath(p.id, m.id)))}
        empty={<Empty size="compact" title={t("provider.noModels")} description={t("provider.noModelsHint")} />}
      />
    </>
  );
}
