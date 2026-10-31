import { Banner, Button, Heading, ProviderBadge, Text, Timeline } from "@logicplanes/kaeso-ui";
import { formatNumber, formatRelative } from "@logicplanes/kaeso-ui/format";
import type { Change, Meta, ProviderSummary } from "../../shared/catalogue.ts";
import { Cell, Cells, HeaderTitle, LinkCell, Metric } from "../cells.tsx";
import { useJson } from "../data.ts";
import { useI18n } from "../i18n/index.ts";
import { Page, whenReady } from "../page.tsx";
import { href, providerPath, RouterLink } from "../router.tsx";
import { changeEvent } from "./changes.tsx";

export const GITHUB = "https://github.com/logicplanes/kpmr";

export function HeaderLinks({ meta }: { meta: Meta | null }) {
  const { t, locale } = useI18n();
  return (
    <span className="flex items-center gap-4">
      {meta && (
        <RouterLink
          href={href(locale, "/format")}
          className="hidden h-32 items-center rounded-pill px-10 mono text-small text-fg-secondary transition-control hover:text-fg focus-ring sm:inline-flex"
        >
          {`format ${meta.format} · ${meta.revision.slice(-12)}`}
        </RouterLink>
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
  const ready = meta.state === "ready" ? meta.data : null;
  return (
    <Page title={<HeaderTitle title={t("nav.overview")} />} documentTitle={t("app.fullName")} padding="none" actions={<HeaderLinks meta={ready} />}>
      {whenReady(meta, (m) => (
        <Overview meta={m} />
      ))}
    </Page>
  );
}

function Overview({ meta }: { meta: Meta }) {
  const { t, locale } = useI18n();
  const providers = useJson<ProviderSummary[]>("/v1/providers.json");
  const changes = useJson<Change[]>("/v1/changes.json?limit=8");
  const steps = [
    { title: "models.dev", body: t("overview.step.models_dev") },
    { title: t("overview.step.registry"), body: t("overview.step.registry.body") },
    { title: t("overview.step.catalogue"), body: t("overview.step.catalogue.body") },
  ];
  return (
    <>
      <div className="flex flex-col gap-8 px-24 pt-48 pb-40 hairline-b-strong">
        <Heading level={1} size="title-lg">
          {t("app.fullName")}
        </Heading>
        <Text tone="secondary">{t("overview.tagline")}</Text>
      </div>
      {meta.models_dev.last_error && (
        <Banner tone="warning" layout="full">
          {t("overview.checkFailed", { when: formatRelative(meta.models_dev.fetched_at) })}
        </Banner>
      )}
      <Cells columns={4}>
        <Metric label={t("overview.stat.providers")} value={formatNumber(meta.catalogue.providers)} />
        <Metric label={t("overview.stat.models")} value={formatNumber(meta.catalogue.models)} />
        <Metric label={t("overview.stat.corrected")} value={formatNumber(meta.catalogue.corrected)} />
        <Metric label={t("overview.stat.added")} value={formatNumber(meta.catalogue.added)} />
      </Cells>
      <Cells columns={3}>
        {steps.map((s, i) => (
          <Cell key={s.title}>
            <Text variant="caption" tone="tertiary" tabular>
              {String(i + 1).padStart(2, "0")}
            </Text>
            <Text weight="medium">{s.title}</Text>
            <Text tone="secondary">{s.body}</Text>
          </Cell>
        ))}
      </Cells>
      {whenReady(providers, (list) => (
        <Cells columns={3} label={t("nav.kaesoProviders")}>
          {list
            .filter((p) => p.kaeso)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((p) => (
              <LinkCell key={p.id} href={href(locale, providerPath(p.id))} label={p.name}>
                <span className="flex items-center justify-between gap-12">
                  <Text tone="secondary">{p.name}</Text>
                  <Text as="span" tone="tertiary" className="opacity-0 transition-control group-hover/cell:opacity-100" aria-hidden="true">
                    →
                  </Text>
                </span>
                <span className="flex items-end justify-between gap-12">
                  <ProviderBadge provider={p.id} name={p.name} size="xl" />
                  <span className="flex flex-col items-end">
                    <Text variant="metric">{formatNumber(p.models)}</Text>
                    <Text variant="small" tone="tertiary">
                      {t("overview.stat.models")}
                    </Text>
                  </span>
                </span>
              </LinkCell>
            ))}
        </Cells>
      ))}
      {changes.state === "ready" && changes.data.length > 0 && (
        <div className="flex flex-col gap-16 px-24 py-40">
          <Text weight="medium">{t("overview.recent")}</Text>
          <Timeline events={changes.data.map((c, i) => changeEvent(c, i, t, locale))} />
        </div>
      )}
      <div className="flex items-center justify-between gap-16 px-24 py-24">
        <Text variant="small" tone="tertiary">
          {t("overview.checked", { when: formatRelative(meta.models_dev.checked_at) })}
        </Text>
        <Text variant="small" tone="tertiary" mono>
          {meta.registry.commit}
        </Text>
      </div>
    </>
  );
}
