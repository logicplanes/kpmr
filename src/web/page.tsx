import { useEffect, type ReactNode } from "react";
import { AppFrame, Button, Empty, PageHeader, Skeleton, SkeletonLine } from "@logicplanes/kaeso-ui";
import { formatPrice } from "@logicplanes/kaeso-ui/format";
import type { Loaded } from "./data.ts";
import { useI18n } from "./i18n/index.ts";
import { href, useLocation } from "./router.tsx";

export function Page({
  title,
  documentTitle,
  actions,
  padding = "page",
  children,
}: {
  title: ReactNode;
  documentTitle: string;
  actions?: ReactNode;
  padding?: "page" | "list" | "none";
  children: ReactNode;
}) {
  const { t } = useI18n();
  useEffect(() => {
    document.title = documentTitle === t("app.fullName") ? t("seo.overview.title") : t("title.page", { page: documentTitle });
  }, [documentTitle, t]);
  return (
    <>
      <PageHeader start={<AppFrame.MenuButton />} title={title} actions={actions} />
      <AppFrame.Body id="kpmr-main" padding={padding}>
        {children}
      </AppFrame.Body>
    </>
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-24" aria-busy="true" aria-label={t("common.loading")}>
      <div className="flex flex-wrap gap-x-48 gap-y-24">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-8">
            <Skeleton className="h-32 w-120" />
            <SkeletonLine className="w-80" />
          </div>
        ))}
      </div>
      <SkeletonLine className="w-320" />
      <SkeletonLine className="w-240" />
    </div>
  );
}

export function Failed({ retry }: { retry: () => void }) {
  const { t } = useI18n();
  return (
    <Empty
      title={t("common.failed")}
      description={t("common.failedHint")}
      actions={
        <Button size="sm" variant="secondary" onClick={retry}>
          {t("common.retry")}
        </Button>
      }
    />
  );
}

export function Missing({ title, description }: { title: string; description: string }) {
  const { t } = useI18n();
  const { locale } = useLocation();
  return (
    <Empty
      title={title}
      description={description}
      actions={
        <Button size="sm" variant="secondary" href={href(locale, "/")}>
          {t("common.goHome")}
        </Button>
      }
    />
  );
}

export function whenReady<T>(loaded: Loaded<T>, ready: (data: T) => ReactNode, missing?: ReactNode): ReactNode {
  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "error") return <Failed retry={loaded.retry} />;
  if (loaded.state === "missing") return missing ?? null;
  return ready(loaded.data);
}

export const price = (value: string | null, unknown: string) => (value === null ? unknown : formatPrice(value));
