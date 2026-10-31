import { useMemo, useState } from "react";
import { DataTable, ProviderBadge, SearchInput, Segmented, Toolbar, col, Empty } from "@logicplanes/kaeso-ui";
import type { ProviderSummary } from "../../shared/catalogue.ts";
import { useJson } from "../data.ts";
import { useI18n } from "../i18n/index.ts";
import { Page } from "../page.tsx";
import { HeaderTitle } from "../cells.tsx";
import { HeaderLinks } from "./overview.tsx";
import { formatNumber } from "@logicplanes/kaeso-ui/format";
import { href, navigate, providerPath } from "../router.tsx";

export function ProvidersPage() {
  const { t, locale } = useI18n();
  const [scope, setScope] = useState("kaeso");
  const [query, setQuery] = useState("");
  const providers = useJson<ProviderSummary[]>("/v1/providers.json");
  const rows = useMemo(() => {
    if (providers.state !== "ready") return [];
    const q = query.trim().toLowerCase();
    return providers.data
      .filter((p) => scope === "all" || p.kaeso)
      .filter((p) => !q || p.id.includes(q) || p.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [providers, scope, query]);
  const columns = [
    col.custom(
      { id: "provider", header: t("providers.provider"), size: 280, grow: true, priority: 1 },
      (p: ProviderSummary) => p.name,
      (_name: string, p) => <ProviderBadge provider={p.id} name={p.name} size="sm" withName />,
    ),
    col.mono({ id: "id", header: "ID", size: 200, priority: 3 }, (p: ProviderSummary) => p.id),
    col.number({ id: "models", header: t("providers.models"), size: 112, priority: 1 }, (p: ProviderSummary) => p.models),
    col.number({ id: "corrected", header: t("providers.corrected"), size: 120, priority: 2 }, (p: ProviderSummary) => p.corrected),
    col.number({ id: "added", header: t("providers.added"), size: 112, priority: 2 }, (p: ProviderSummary) => p.added),
  ];
  return (
    <Page
      title={<HeaderTitle title={t("providers.title")} count={providers.state === "ready" ? formatNumber(rows.length) : undefined} />}
      documentTitle={t("providers.title")}
      padding="none"
      actions={<HeaderLinks meta={null} />}
    >
      <Toolbar aria-label={t("providers.title")}>
        <Segmented
          aria-label={t("providers.scope")}
          size="sm"
          value={scope}
          onValueChange={setScope}
          options={[
            { value: "kaeso", label: t("providers.kaeso") },
            { value: "all", label: t("providers.all") },
          ]}
        />
        <SearchInput
          aria-label={t("providers.search")}
          placeholder={t("providers.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
        />
      </Toolbar>
      <DataTable
        aria-label={t("providers.title")}
        data={rows}
        columns={columns}
        getRowId={(p) => p.id}
        loading={providers.state === "loading"}
        error={providers.state === "error" ? t("providers.failed") : undefined}
        onRetry={providers.state === "error" ? providers.retry : undefined}
        onRowClick={(p) => navigate(href(locale, providerPath(p.id)))}
        virtualizeAbove={80}
        empty={<Empty size="compact" title={t("providers.none")} description={t("providers.noneHint")} />}
      />
    </Page>
  );
}
