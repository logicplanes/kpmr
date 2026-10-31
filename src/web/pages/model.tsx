import type { ReactNode } from "react";
import { Badge, Banner, JsonView, KeyValue, Link, ModelLabel, Section, Text, type Capability, type KeyValueItem } from "@logicplanes/kaeso-ui";
import { formatContext, formatDate } from "@logicplanes/kaeso-ui/format";
import type { CatalogueModel, ModelView, Prices } from "../../shared/catalogue.ts";
import { useJson } from "../data.ts";
import { useI18n, type MessageKey } from "../i18n/index.ts";
import { Missing, Page, price, whenReady } from "../page.tsx";
import { href, providerPath, RouterLink } from "../router.tsx";

export function ModelPage({ provider, model }: { provider: string; model: string }) {
  const { t } = useI18n();
  const view = useJson<ModelView>(`/v1/models/${encodeURIComponent(provider)}/${model.split("/").map(encodeURIComponent).join("/")}.json`);
  const name = view.state === "ready" ? (view.data.model.name ?? model) : model;
  return (
    <Page title={name} documentTitle={`${name} · ${provider}`}>
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
  const flag = (v: boolean | null) => (v === null ? unknown : v ? t("model.yes") : t("model.no"));
  const item = (path: string, value: ReactNode, extra: Partial<KeyValueItem> = {}): KeyValueItem => ({
    label: (
      <span className="flex items-center gap-8">
        {t(`field.${path}` as MessageKey)}
        {(corrected.has(path) || [...corrected].some((c) => c.startsWith(`${path}.`))) && m.origin !== "kpmr" && <Badge tone="info">KPMR</Badge>}
      </span>
    ),
    value,
    ...extra,
  });
  const prices = (["input", "output", "cache_read", "cache_write", "cache_write_1h", "reasoning", "input_audio", "output_audio"] as const)
    .filter((k) => m.pricing[k] !== null || k === "input" || k === "output")
    .map((k) => item(`pricing.${k}`, price(m.pricing[k], unknown), { mono: true }));
  const above = m.pricing.above_200k as Prices | null;
  if (above) prices.push(item("pricing.above_200k", `${price(above.input, unknown)} / ${price(above.output, unknown)}`, { mono: true }));
  const tokens = (v: number | null) => (v === null ? unknown : formatContext(v));

  return (
    <div className="flex max-w-800 flex-col gap-32">
      <div className="flex flex-col gap-12">
        <ModelLabel provider={view.provider.id} providerName={view.provider.name} model={m.id} name={m.name ?? undefined} capabilities={capabilities(m)} />
        <span className="flex flex-wrap items-center gap-8">
          <RouterLink href={href(locale, providerPath(view.provider.id))}>{view.provider.name}</RouterLink>
          <Badge tone={m.origin === "kpmr" ? "info" : "neutral"}>{m.origin === "kpmr" ? t("origin.kpmr") : t("origin.models_dev")}</Badge>
          {m.origin !== "kpmr" && m.corrected.length > 0 && <Badge tone="info">{t("origin.corrected")}</Badge>}
          {m.status !== "active" && <Badge tone={m.status === "deprecated" ? "warning" : "neutral"}>{t(`status.${m.status}`)}</Badge>}
        </span>
        {m.description && <Text tone="secondary">{m.description}</Text>}
      </div>

      <Section title={t("model.prices")} description={t("model.pricesHint")} spacing="none">
        <KeyValue items={prices} />
      </Section>

      <Section title={t("model.limits")} spacing="none">
        <KeyValue
          items={[
            item("limits.context", tokens(m.limits.context)),
            item("limits.input", tokens(m.limits.input)),
            item("limits.output", tokens(m.limits.output)),
            item("modalities.input", m.modalities.input.join(", ") || unknown),
            item("modalities.output", m.modalities.output.join(", ") || unknown),
          ]}
        />
      </Section>

      <Section title={t("model.capabilities")} spacing="none">
        <KeyValue
          items={(Object.keys(m.capabilities) as (keyof CatalogueModel["capabilities"])[]).map((k) => item(`capabilities.${k}`, flag(m.capabilities[k])))}
        />
      </Section>

      {m.reasoning && (
        <Section title={t("model.reasoning")} spacing="none">
          <KeyValue
            items={[
              item("reasoning.efforts", m.reasoning.efforts === null ? unknown : m.reasoning.efforts.join(", ") || t("model.none"), { mono: true }),
              item("reasoning.adaptive_thinking", flag(m.reasoning.adaptive_thinking)),
              item("reasoning.thinking_binding", flag(m.reasoning.thinking_binding)),
            ]}
          />
        </Section>
      )}

      <Section title={t("model.about")} spacing="none">
        <KeyValue
          items={[
            item("kind", m.kind, { mono: true }),
            item("status", t(`status.${m.status}`)),
            item("family", m.family ?? unknown, { mono: m.family !== null }),
            item("release_date", m.release_date ?? unknown),
            item("knowledge", m.knowledge ?? unknown),
            item("open_weights", flag(m.open_weights)),
            item("gateway.egress_dialect", m.gateway.egress_dialect ?? t("model.none"), { mono: m.gateway.egress_dialect !== null }),
          ]}
        />
      </Section>

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
  );
}
