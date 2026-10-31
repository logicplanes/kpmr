import type { ReactNode } from "react";
import { Badge, Banner, Heading, JsonView, Link, ModelLabel, Section, Text, type Capability } from "@logicplanes/kaeso-ui";
import { formatContext, formatDate } from "@logicplanes/kaeso-ui/format";
import type { CatalogueModel, ModelView, Prices } from "../../shared/catalogue.ts";
import { useJson } from "../data.ts";
import { Cell, Cells, HeaderTitle, Metric } from "../cells.tsx";
import { HeaderLinks } from "./overview.tsx";
import { useI18n, type MessageKey } from "../i18n/index.ts";
import { Missing, Page, price, whenReady } from "../page.tsx";
import { href, providerPath, RouterLink } from "../router.tsx";

export function ModelPage({ provider, model }: { provider: string; model: string }) {
  const { t } = useI18n();
  const view = useJson<ModelView>(`/v1/models/${encodeURIComponent(provider)}/${model.split("/").map(encodeURIComponent).join("/")}.json`);
  const name = view.state === "ready" ? (view.data.model.name ?? model) : model;
  return (
    <Page
      title={<HeaderTitle title={name} count={view.state === "ready" ? view.data.provider.name : provider} />}
      documentTitle={`${name} · ${provider}`}
      padding="none"
      actions={<HeaderLinks meta={null} />}
    >
      {whenReady(
        view,
        (v) => (
          <Model view={v} />
        ),
        <Missing title={t("model.notFound")} description={t("model.notFoundHint", { model, provider })} />,
      )}
    </Page>
  );
}

function capabilities(m: CatalogueModel): Capability[] {
  const out: Capability[] = [];
  if (m.capabilities.tool_call) out.push("tools");
  if (m.capabilities.reasoning) out.push("reasoning");
  if (m.modalities.input.includes("image")) out.push("vision");
  if (m.modalities.input.includes("pdf")) out.push("pdf");
  if (m.capabilities.structured_output) out.push("structuredOutput");
  return out;
}

function Model({ view }: { view: ModelView }) {
  const { t, locale } = useI18n();
  const m = view.model;
  const corrected = new Set(m.corrected);
  const unknown = t("model.unknown");
  const tokens = (v: number | null) => (v === null ? unknown : formatContext(v));
  const flag = (v: boolean | null) => (v === null ? unknown : v ? t("model.yes") : t("model.no"));
  const isCorrected = (path: string) => m.origin !== "kpmr" && (corrected.has(path) || [...corrected].some((c) => c.startsWith(`${path}.`)));
  const field = (path: string, value: ReactNode, mono = false) => (
    <Cell key={path}>
      <span className="flex items-center justify-between gap-8">
        <Text variant="small" tone="secondary" truncate>
          {t(`field.${path}` as MessageKey)}
        </Text>
        {isCorrected(path) && <Badge tone="info">KPMR</Badge>}
      </span>
      <Text mono={mono} truncate>
        {value}
      </Text>
    </Cell>
  );
  const group = (title: string, cells: ReactNode[], hint?: string) => (
    <section aria-label={title}>
      <div className="flex items-baseline gap-12 px-24 pt-40 pb-16 hairline-b-strong">
        <Text weight="medium">{title}</Text>
        {hint && (
          <Text variant="small" tone="tertiary">
            {hint}
          </Text>
        )}
      </div>
      <Cells columns={4}>{cells}</Cells>
    </section>
  );
  const prices = (["input", "output", "cache_read", "cache_write", "cache_write_1h", "reasoning", "input_audio", "output_audio"] as const)
    .filter((k) => m.pricing[k] !== null || k === "input" || k === "output")
    .map((k) => field(`pricing.${k}`, price(m.pricing[k], unknown), true));
  const above = m.pricing.above_200k as Prices | null;
  if (above) prices.push(field("pricing.above_200k", `${price(above.input, unknown)} / ${price(above.output, unknown)}`, true));

  return (
    <>
      <div className="flex flex-col gap-12 px-24 pt-40 pb-32 hairline-b-strong">
        <Heading level={1} size="title-lg">
          {m.name ?? m.id}
        </Heading>
        <ModelLabel className="self-start" provider={view.provider.id} providerName={view.provider.name} model={m.id} capabilities={capabilities(m)} />
        <span className="flex flex-wrap items-center gap-8">
          <RouterLink href={href(locale, providerPath(view.provider.id))}>{view.provider.name}</RouterLink>
          <Badge tone={m.origin === "kpmr" ? "info" : "neutral"}>{m.origin === "kpmr" ? t("origin.kpmr") : t("origin.models_dev")}</Badge>
          {m.origin !== "kpmr" && m.corrected.length > 0 && <Badge tone="info">{t("origin.corrected")}</Badge>}
          {m.status !== "active" && <Badge tone={m.status === "deprecated" ? "warning" : "neutral"}>{t(`status.${m.status}`)}</Badge>}
        </span>
        {m.description && (
          <Text tone="secondary" className="max-w-720">
            {m.description}
          </Text>
        )}
      </div>
      <Cells columns={4}>
        <Metric label={t("field.pricing.input")} value={price(m.pricing.input, unknown)} />
        <Metric label={t("field.pricing.output")} value={price(m.pricing.output, unknown)} />
        <Metric label={t("field.limits.context")} value={tokens(m.limits.context)} />
        <Metric label={t("model.outputLimit")} value={tokens(m.limits.output)} />
      </Cells>
      {group(t("model.prices"), prices, t("model.pricesHint"))}
      {group(t("model.limits"), [
        field("limits.context", tokens(m.limits.context)),
        field("limits.input", tokens(m.limits.input)),
        field("limits.output", tokens(m.limits.output)),
        field("modalities.input", m.modalities.input.join(", ") || unknown),
        field("modalities.output", m.modalities.output.join(", ") || unknown),
      ])}
      {group(
        t("model.capabilities"),
        (Object.keys(m.capabilities) as (keyof CatalogueModel["capabilities"])[]).map((k) => field(`capabilities.${k}`, flag(m.capabilities[k]))),
      )}
      {m.reasoning &&
        group(t("model.reasoning"), [
          field("reasoning.efforts", m.reasoning.efforts === null ? unknown : m.reasoning.efforts.join(", ") || t("model.none"), true),
          field("reasoning.adaptive_thinking", flag(m.reasoning.adaptive_thinking)),
          field("reasoning.thinking_binding", flag(m.reasoning.thinking_binding)),
        ])}
      {group(t("model.about"), [
        field("kind", m.kind, true),
        field("status", t(`status.${m.status}`)),
        field("family", m.family ?? unknown, m.family !== null),
        field("release_date", m.release_date ?? unknown),
        field("knowledge", m.knowledge ?? unknown),
        field("open_weights", flag(m.open_weights)),
        field("gateway.egress_dialect", m.gateway.egress_dialect ?? t("model.none"), m.gateway.egress_dialect !== null),
      ])}
      <div className="flex max-w-800 flex-col gap-40 px-24 pt-40 pb-48">
        {(view.entry || view.rules.length > 0) && (
          <Section title={t("model.entry")} description={t("model.entryHint")} spacing="none">
            <div className="flex flex-col gap-16">
              {view.entry?.note && <Banner tone="info">{view.entry.note}</Banner>}
              {view.entry && (
                <div className="flex flex-col gap-8">
                  <Text weight="semibold">{t("model.sources")}</Text>
                  <ul className="flex flex-col gap-8">
                    {view.entry.sources.map((s) => (
                      <li key={`${s.url}-${s.checked}`} className="flex flex-col">
                        <Link href={s.url} external>
                          {s.url.replace(/^https:\/\//, "")}
                        </Link>
                        <Text variant="small" tone="secondary">
                          {t("model.checked", { date: formatDate(s.checked) })}
                          {s.note ? ` · ${s.note}` : ""}
                        </Text>
                      </li>
                    ))}
                  </ul>
                  <Text variant="small" tone="tertiary" mono>
                    {view.entry.file}
                  </Text>
                </div>
              )}
              {view.rules.map((r) => (
                <div key={r.set} className="flex flex-col gap-4">
                  <Text weight="semibold">{t("model.rules")}</Text>
                  <Text mono>{t("model.rule", { set: r.set, multiply: r.multiply, from: r.from })}</Text>
                  {r.note && <Text tone="secondary">{r.note}</Text>}
                  {r.sources.map((s) => (
                    <Link key={s.url} href={s.url} external>
                      {s.url.replace(/^https:\/\//, "")}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title={t("model.catalogue")} description={t("model.catalogueHint")} spacing="none">
          <JsonView value={m} defaultDepth={1} />
        </Section>

        <Section title={t("model.modelsDev")} description={t("model.modelsDevHint")} spacing="none">
          {view.models_dev ? <JsonView value={view.models_dev} defaultDepth={1} /> : <Text tone="secondary">{t("model.notOnModelsDev")}</Text>}
        </Section>
      </div>
    </>
  );
}
