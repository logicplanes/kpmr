import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AppFrame, LinkProvider, Sidebar, ThemeProvider, TooltipProvider, Toaster, icons, Select, ThemeSelect } from "@logicplanes/kaeso-ui";
import { setFormatLocale } from "@logicplanes/kaeso-ui/format";
import { LocaleProvider, loadUiMessages, type UiMessages } from "@logicplanes/kaeso-ui/i18n";
import { I18nContext, LOCALES, LOCALE_NAMES, translator, useI18n, type Locale } from "./i18n/index.ts";
import { href, LocationProvider, navigate, RouterLink, useLocation, type Route } from "./router.tsx";
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
                <Sidebar.Item icon={icons.home} href="https://kaeso.app">
                  kaeso.app
                </Sidebar.Item>
                <Sidebar.Item icon={icons.help} href="https://docs.kaeso.app">
                  {t("nav.docs")}
                </Sidebar.Item>
              </Sidebar.Group>
            </Sidebar.Content>
            <Sidebar.Footer>
              <div className="grid grid-cols-2 gap-4">
                <Select
                  aria-label={t("nav.language")}
                  size="sm"
                  appearance="ghost"
                  fullWidth
                  value={locale}
                  options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
                  onValueChange={(next: string) => navigate(href(next as Locale, path))}
                />
                <ThemeSelect fullWidth />
              </div>
            </Sidebar.Footer>
          </Sidebar>
        }
      >
        <Suspense fallback={null}>
          <Page route={route} />
        </Suspense>
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
