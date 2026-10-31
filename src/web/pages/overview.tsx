import { Badge, Banner, Button, ProviderBadge, Text } from "@logicplanes/kaeso-ui";
import { formatNumber, formatRelative } from "@logicplanes/kaeso-ui/format";
import type { Meta, ProviderSummary } from "../../shared/catalogue.ts";
import { Cells, HeaderTitle, LinkCell } from "../cells.tsx";
import { useJson } from "../data.ts";
import { useI18n } from "../i18n/index.ts";
import { Page, whenReady } from "../page.tsx";
import { href, providerPath, RouterLink } from "../router.tsx";

export const GITHUB = "https://github.com/logicplanes/kpmr";

export function HeaderLinks({ meta, start = false }: { meta: Meta | null; start?: boolean }) {
  const { t, locale } = useI18n();
  return (
    <span className="flex items-center gap-4">
      {meta && (
        <RouterLink
          href={href(locale, "/changes")}
          className="hidden h-32 items-center rounded-pill px-10 mono text-small text-fg-secondary transition-control hover:text-fg focus-ring sm:inline-flex"
        >
          {`format ${meta.format} · ${meta.revision.slice(-12)}`}
        </RouterLink>
      )}
      {start && (
        <Button variant="ghost" size="sm" href={href(locale, "/format")}>
          {t("nav.format")}
        </Button>
      )}
      <Button variant="ghost" size="sm" href={GITHUB}>
        {`${t("nav.github")} ↗`}
      </Button>
    </span>
  );
}

export function OverviewPage() {
  const { t } = useI18n();
  const meta = useJson<Meta>("/v1/meta.json");
  const providers = useJson<ProviderSummary[]>("/v1/providers.json");
  const count = providers.state === "ready" ? formatNumber(providers.data.length) : undefined;
  return (
    <Page
      title={<HeaderTitle title={t("providers.title")} count={count} />}
      documentTitle={t("app.fullName")}
      padding="none"
      actions={<HeaderLinks meta={meta.state === "ready" ? meta.data : null} start />}
    >
      {meta.state === "ready" && meta.data.models_dev.last_error && (
        <Banner tone="warning" layout="full">
          {t("overview.checkFailed", { when: formatRelative(meta.data.models_dev.fetched_at) })}
        </Banner>
      )}
      {whenReady(providers, (list) => (
        <ProviderGrid providers={list} />
      ))}
    </Page>
  );
}

function ProviderGrid({ providers }: { providers: ProviderSummary[] }) {
  const { t, locale } = useI18n();
  const sorted = [...providers].sort((a, b) => Number(b.kaeso) - Number(a.kaeso) || a.name.localeCompare(b.name));
  return (
    <Cells columns={3} label={t("providers.title")}>
      {sorted.map((p) => (
        <LinkCell key={p.id} href={href(locale, providerPath(p.id))} label={p.name}>
          <span className="flex items-center gap-6">
            <Text tone="secondary" truncate>
              {p.name}
            </Text>
            <Text as="span" tone="tertiary" className="opacity-0 transition-control group-hover/cell:opacity-100" aria-hidden="true">
              →
            </Text>
          </span>
          <span className="flex flex-1 flex-col items-center justify-center gap-12 py-24">
            <ProviderBadge provider={p.id} name={p.name} size="xl" />
            <span className="flex items-center gap-8">
              <Text variant="small" tone="secondary" tabular>
                {t("overview.modelCount", { count: p.models })}
              </Text>
              {p.kaeso && <Badge tone="success">Kaeso</Badge>}
              {p.corrected + p.added > 0 && <Badge tone="outline">KPMR</Badge>}
            </span>
          </span>
        </LinkCell>
      ))}
    </Cells>
  );
}
