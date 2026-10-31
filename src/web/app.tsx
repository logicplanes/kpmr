import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AppFrame, Icon, LinkProvider, Sidebar, ThemeProvider, TooltipProvider, Toaster, icons } from "@logicplanes/kaeso-ui";
import { setFormatLocale } from "@logicplanes/kaeso-ui/format";
import { LocaleProvider, loadUiMessages, type UiMessages } from "@logicplanes/kaeso-ui/i18n";
import { I18nContext, translator, useI18n, type Locale } from "./i18n/index.ts";
import { SidebarFooter } from "./footer.tsx";
import { PageBoundary } from "./boundary.tsx";
import { Failed } from "./page.tsx";
import { href, LocationProvider, RouterLink, useLocation, type Route } from "./router.tsx";
import { NotFoundPage } from "./pages/not-found.tsx";
import { OverviewPage } from "./pages/overview.tsx";
import { ProviderPage } from "./pages/provider.tsx";
import { ProvidersPage } from "./pages/providers.tsx";

const ChangesPage = lazy(() => import("./pages/changes.tsx").then((m) => ({ default: m.ChangesPage })));
const FormatPage = lazy(() => import("./pages/format.tsx").then((m) => ({ default: m.FormatPage })));
const ModelPage = lazy(() => import("./pages/model.tsx").then((m) => ({ default: m.ModelPage })));

export function App() {
  return (
    <LocationProvider>
      <Localized />
    </LocationProvider>
  );
}

function Localized() {
  const { locale } = useLocation();
  const [ui, setUi] = useState<{ locale: Locale; messages: UiMessages } | null>(null);
  const value = useMemo(() => ({ locale, t: translator(locale) }), [locale]);
  useEffect(() => {
    let live = true;
    document.documentElement.lang = locale;
    setFormatLocale(locale);
    void loadUiMessages(locale).then((messages) => live && setUi({ locale, messages }));
    return () => {
      live = false;
    };
  }, [locale]);
  return (
    <I18nContext.Provider value={value}>
      <LocaleProvider locale={locale} messages={ui?.locale === locale ? ui.messages : undefined}>
        <ThemeProvider>
          <TooltipProvider>
            <LinkProvider component={RouterLink}>
              <Shell />
            </LinkProvider>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </LocaleProvider>
    </I18nContext.Provider>
  );
}

const PAGES = [
  { id: "overview", path: "/", icon: icons.overview, label: "nav.overview" },
  { id: "providers", path: "/providers", icon: icons.provider, label: "nav.providers" },
  { id: "changes", path: "/changes", icon: icons.audit, label: "nav.changes" },
  { id: "format", path: "/format", icon: icons.code, label: "nav.format" },
] as const;

function section(route: Route): string {
  if (route.page === "provider" || route.page === "model") return "providers";
  return route.page;
}

function Shell() {
  const { locale, route, path } = useLocation();
  const { t } = useI18n();
  const current = section(route);
  return (
    <Sidebar.Provider storageKey="kpmr:sidebar">
      <AppFrame
        brandHref={href(locale, "/")}
        brandLabel={t("app.home")}
        sidebar={
          <Sidebar aria-label={t("app.navigation")}>
            <Sidebar.Brand href={href(locale, "/")} label={t("app.home")}>
              <Sidebar.CollapseToggle />
            </Sidebar.Brand>
            <Sidebar.Content>
              <Sidebar.Group label={t("app.name")}>
                {PAGES.map((p) => (
                  <Sidebar.Item key={p.id} icon={p.icon} href={href(locale, p.path)} active={current === p.id}>
                    {t(p.label)}
                  </Sidebar.Item>
                ))}
              </Sidebar.Group>
              <Sidebar.Group label={t("nav.kaeso")}>
                <Sidebar.Item href="https://kaeso.app" trailing={<Icon icon={icons.externalLink} size="xs" />}>
                  kaeso.app
                </Sidebar.Item>
                <Sidebar.Item href="https://docs.kaeso.app" trailing={<Icon icon={icons.externalLink} size="xs" />}>
                  {t("nav.docs")}
                </Sidebar.Item>
                <Sidebar.Item href="https://github.com/logicplanes/kpmr" trailing={<Icon icon={icons.externalLink} size="xs" />}>
                  GitHub
                </Sidebar.Item>
              </Sidebar.Group>
            </Sidebar.Content>
            <Sidebar.Footer className="gap-8">
              <SidebarFooter />
            </Sidebar.Footer>
          </Sidebar>
        }
      >
        <PageBoundary resetKey={path} fallback={<Failed retry={() => window.location.reload()} />}>
          <Suspense fallback={null}>
            <Page route={route} />
          </Suspense>
        </PageBoundary>
      </AppFrame>
    </Sidebar.Provider>
  );
}

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case "overview":
      return <OverviewPage />;
    case "providers":
      return <ProvidersPage />;
    case "provider":
      return <ProviderPage id={route.provider} />;
    case "model":
      return <ModelPage provider={route.provider} model={route.model} />;
    case "changes":
      return <ChangesPage />;
    case "format":
      return <FormatPage />;
    default:
      return <NotFoundPage />;
  }
}
