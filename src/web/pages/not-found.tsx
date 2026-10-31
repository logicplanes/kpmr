import { useI18n } from "../i18n/index.ts";
import { Missing, Page } from "../page.tsx";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <Page title={t("common.notFound")} documentTitle={t("common.notFound")}>
      <Missing title={t("common.notFound")} description={t("common.notFoundHint")} />
    </Page>
  );
}
