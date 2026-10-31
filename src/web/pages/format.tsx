import { CodeBlock, KeyValue, Section, Text } from "@logicplanes/kaeso-ui";
import { FORMAT, MEDIA_TYPE, type Meta, type ModelView } from "../../shared/catalogue.ts";
import { useJson } from "../data.ts";
import { useI18n, type MessageKey } from "../i18n/index.ts";
import { Page, whenReady } from "../page.tsx";

const ORIGIN = "https://kpmr.kaeso.app";
const SAMPLE = "/v1/models/anthropic/claude-sonnet-5-5.json";

const REQUEST = `GET /v1/catalogue?providers=anthropic,openai,mistral HTTP/1.1
Host: kpmr.kaeso.app
Accept: ${MEDIA_TYPE}; version=${FORMAT}
Accept-Encoding: br, gzip
If-None-Match: "TBZDfwxDDgnfsglvFAGIRhKMmTT"
User-Agent: kaeso-gateway/0.5.0`;

const RESPONSE = `HTTP/1.1 200 OK
Content-Type: ${MEDIA_TYPE}; version=${FORMAT}
Content-Encoding: br
ETag: "Q1n5Wc0hXn2yH7f0b1o9GQ2kLsd"
KPMR-Revision: 2026-10-31T21:40:12Z-3f9c2a7b1d04
KPMR-Signature: keyid=kpmr-2026-10, ed25519=4Wl0…Kw==
Cache-Control: public, max-age=60, stale-while-revalidate=600`;

const VERIFY = `import { createPublicKey, verify } from "node:crypto";

const response = await fetch("${ORIGIN}/v1/catalogue?providers=anthropic", {
  headers: { accept: "${MEDIA_TYPE}; version=${FORMAT}" },
});
const body = Buffer.from(await response.arrayBuffer());
const header = response.headers.get("kpmr-signature") ?? "";
const signature = Buffer.from(/ed25519=([^,\\s]+)/.exec(header)?.[1] ?? "", "base64");
const [key] = await (await fetch("${ORIGIN}/v1/keys.json")).json();
const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(key.public_key, "base64")]);
const ok = verify(null, body, createPublicKey({ key: spki, format: "der", type: "spki" }), signature);
const catalogue = ok ? JSON.parse(body.toString("utf8")) : null;`;

const FIELDS = ["kind", "status", "modalities", "limits", "pricing", "capabilities", "reasoning", "gateway", "origin", "corrected"] as const;

const ENDPOINTS = [
  ["/v1/meta.json", "meta"],
  ["/v1/providers.json", "providers"],
  ["/v1/providers/<provider>.json", "provider"],
  ["/v1/models/<provider>/<model>.json", "model"],
  ["/v1/changes.json", "changes"],
  ["/v1/keys.json", "keys"],
] as const;

export function FormatPage() {
  const { t } = useI18n();
  const meta = useJson<Meta>("/v1/meta.json");
  const sample = useJson<ModelView>(SAMPLE);
  return (
    <Page title={t("format.title")} documentTitle={t("format.title")}>
      <div className="flex max-w-800 flex-col gap-40">
        <Text variant="body-lg" tone="secondary">
          {t("format.lead")}
        </Text>

        <Section title={t("format.conversation")} description={t("format.conversationBody")} spacing="none">
          <div className="flex flex-col gap-16">
            <CodeBlock title={t("format.request")} lang="text" code={REQUEST} />
            <CodeBlock title={t("format.response")} lang="text" code={RESPONSE} />
            <KeyValue
              items={(["200", "304", "406", "503"] as const).map((code) => ({
                label: code,
                value: t(`format.answer.${code}`),
                mono: false,
                wrap: true,
              }))}
            />
          </div>
        </Section>

        <Section title={t("format.body")} description={t("format.bodyBody")} spacing="none">
          <div className="flex flex-col gap-16">
            {whenReady(sample, (v) => (
              <CodeBlock title="providers.anthropic.models.claude-sonnet-5-5" lang="json" code={JSON.stringify(v.model, null, 2)} collapseAfter={32} />
            ))}
            <Text weight="semibold">{t("format.fields")}</Text>
            <KeyValue items={FIELDS.map((f) => ({ label: f, value: t(`format.field.${f}` as MessageKey), wrap: true }))} />
          </div>
        </Section>

        <Section title={t("format.signature")} description={t("format.signatureBody")} spacing="none">
          <div className="flex flex-col gap-16">
            <CodeBlock title="verify.mjs" lang="js" code={VERIFY} />
            {whenReady(meta, (m) => (
              <KeyValue items={m.keys.map((k) => ({ label: `${t("format.keys")} · ${k.id}`, value: k.public_key, mono: true, copy: k.public_key }))} />
            ))}
          </div>
        </Section>

        <Section title={t("format.versioning")} spacing="none">
          <Text tone="secondary">{t("format.versioningBody")}</Text>
        </Section>

        <Section title={t("format.endpoints")} spacing="none">
          <KeyValue items={ENDPOINTS.map(([path, key]) => ({ label: path, value: t(`format.endpoint.${key}`), wrap: true }))} />
        </Section>
      </div>
    </Page>
  );
}
