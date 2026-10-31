import { IconButton, Menu, ThemeMenu, icons } from "@logicplanes/kaeso-ui";
import { LOCALES, LOCALE_NAMES, useI18n, type Locale } from "./i18n/index.ts";
import { href, navigate, useLocation } from "./router.tsx";

const KAESO_APP: Record<Locale, string> = { en: "https://kaeso.app", de: "https://kaeso.app/de", "zh-CN": "https://kaeso.app/zh-CN" };

function LegalMenu() {
  const { t, locale } = useI18n();
  const base = KAESO_APP[locale];
  return (
    <Menu>
      <Menu.Trigger>
        <IconButton icon={icons.legal} aria-label={t("legal.label")} />
      </Menu.Trigger>
      <Menu.Content side="top" align="start" className="min-w-180">
        <Menu.LinkItem href={`${base}/datenschutz`}>{t("legal.privacy")}</Menu.LinkItem>
        <Menu.LinkItem href={`${base}/impressum`}>{t("legal.imprint")}</Menu.LinkItem>
        <Menu.LinkItem href="/licenses.txt">{t("legal.licenses")}</Menu.LinkItem>
      </Menu.Content>
    </Menu>
  );
}

function LanguageMenu() {
  const { t, locale } = useI18n();
  const { path, search } = useLocation();
  const query = search.toString();
  return (
    <Menu>
      <Menu.Trigger>
        <IconButton icon={icons.language} aria-label={t("nav.language")} />
      </Menu.Trigger>
      <Menu.Content side="top" align="start" className="min-w-180">
        <Menu.RadioGroup
          value={locale}
          onValueChange={(value: string) => {
            if (value !== locale && (LOCALES as readonly string[]).includes(value)) navigate(href(value as Locale, path) + (query ? `?${query}` : ""));
          }}
        >
          {LOCALES.map((l) => (
            <Menu.RadioItem key={l} value={l}>
              <span lang={l}>{LOCALE_NAMES[l]}</span>
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.Content>
    </Menu>
  );
}

export function SidebarFooter() {
  return (
    <>
      <LegalMenu />
      <ThemeMenu side="top" align="start" />
      <LanguageMenu />
    </>
  );
}
