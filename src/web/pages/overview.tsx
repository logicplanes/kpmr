import { Banner, Grid, Heading, KeyValue, Link, List, MetricRow, ProviderBadge, Section, Stat, Text, Timeline, Empty } from "@logicplanes/kaeso-ui";
import { formatNumber, formatRelative } from "@logicplanes/kaeso-ui/format";
import type { Change, Meta, ProviderSummary } from "../../shared/catalogue.ts";
import { useJson } from "../data.ts";
import { useI18n } from "../i18n/index.ts";
import { Page, whenReady } from "../page.tsx";
import { href, modelPath, navigate, providerPath, useLocation } from "../router.tsx";
import { changeEvent } from "./changes.tsx";

export function OverviewPage() {
  const { t } = useI18n();
  const meta = useJson<Meta>("/v1/meta.json");
  return (
    <Page title={t("overview.title")} documentTitle={t("app.fullName")}>
      {whenReady(meta, (m) => (
        <Overview meta={m} />
      ))}
    </Page>
  );
}

function Overview({ meta }: { meta: Meta }) {
  const { t } = useI18n();
  const { locale } = useLocation();
  const providers = useJson<ProviderSummary[]>("/v1/providers.json");
  const changes = useJson<Change[]>("/v1/changes.json?limit=6");
  const steps = (["sync", "registry", "catalogue"] as const).map((k) => ({
    title: t(`overview.how.${k}.title`),
    body: t(`overview.how.${k}.body`),
  }));
  return (
    <div className="flex max-w-800 flex-col gap-40">
      <div className="flex flex-col gap-12">
        <Heading level={1} size="title-lg">
          {t("overview.heading")}
        </Heading>
        <Text variant="body-lg" tone="secondary" className="max-w-720">
          {t("overview.lead")}
        </Text>
      </div>
      {meta.models_dev.last_error && <Banner tone="warning">{t("overview.checkFailed", { when: formatRelative(meta.models_dev.fetched_at) })}</Banner>}
      <MetricRow>
        <Stat value={formatNumber(meta.catalogue.providers)} unit={t("overview.providers")} />
        <Stat value={formatNumber(meta.catalogue.models)} unit={t("overview.models")} />
        <Stat value={formatNumber(meta.catalogue.corrected)} unit={t("overview.corrected")} />
        <Stat value={formatNumber(meta.catalogue.added)} unit={t("overview.added")} />
      </MetricRow>
      <Section title={t("overview.how")} spacing="none">
        <Grid columns={3} gap={24}>
          {steps.map((s) => (
            <div key={s.title} className="flex flex-col gap-4">
              <Text weight="semibold">{s.title}</Text>
              <Text tone="secondary">{s.body}</Text>
            </div>
          ))}
        </Grid>
      </Section>
      <Section title={t("overview.kaesoProviders")} description={t("overview.kaesoProvidersHint")} spacing="none">
        {whenReady(providers, (list) => (
          <List
            aria-label={t("overview.kaesoProviders")}
            items={list
              .filter((p) => p.kaeso)
              .map((p) => ({
                id: p.id,
                title: p.name,
                textValue: p.name,
                leading: <ProviderBadge provider={p.id} name={p.name} size="sm" />,
                meta: t("common.modelCount", { count: p.models }),
              }))}
            onOpen={(item) => navigate(href(locale, providerPath(item.id)))}
          />
        ))}
      </Section>
      <Section
        title={t("overview.recent")}
        spacing="none"
        actions={
          <Link href={href(locale, "/changes")} variant="quiet">
            {t("overview.allChanges")}
          </Link>
        }
      >
        {whenReady(changes, (list) =>
          list.length === 0 ? (
            <Empty size="md" title={t("overview.noChanges")} description={t("overview.noChangesHint")} />
          ) : (
            <Timeline events={list.map((c, i) => changeEvent(c, i, t, locale))} />
          ),
        )}
      </Section>
      {meta.notes.length > 0 && (
        <Section title={t("overview.notes")} description={t("overview.notesHint")} spacing="none">
          <List
            aria-label={t("overview.notes")}
            items={meta.notes.map((n, i) => ({
              id: String(i),
              title: n.model ? `${n.provider} / ${n.model}` : n.provider,
              subtitle: [t(`note.${n.kind}`), ...n.fields].join(" · "),
              meta: n.file,
            }))}
            onOpen={(item) => {
              const n = meta.notes[Number(item.id)];
              if (n?.model) navigate(href(locale, modelPath(n.provider, n.model)));
            }}
          />
        </Section>
      )}
      <Section title={t("overview.status")} spacing="none">
        <KeyValue
          items={[
            { label: t("overview.lastCheck"), value: formatRelative(meta.models_dev.checked_at) },
            { label: t("overview.lastFetch"), value: formatRelative(meta.models_dev.fetched_at) },
            { label: t("overview.revision"), value: meta.revision, mono: true, copy: meta.revision },
            { label: t("overview.registryCommit"), value: meta.registry.commit, mono: true },
            ...meta.keys.map((k) => ({ label: t("overview.signingKey"), value: `${k.id} · ${k.public_key}`, mono: true, copy: k.public_key })),
          ]}
        />
      </Section>
    </div>
  );
}
