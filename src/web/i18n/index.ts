import { createContext, useContext } from "react";
import { formatMessage, type MessageValues } from "@logicplanes/kaeso-ui/i18n";
import { de } from "./de.ts";
import { en, type MessageKey, type Messages } from "./en.ts";
import { zhCN } from "./zh-CN.ts";

export const LOCALES = ["en", "de", "zh-CN"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", de: "Deutsch", "zh-CN": "简体中文" };

export const CATALOGS: Record<Locale, Messages> = { en, de, "zh-CN": zhCN };

export type Translate = (key: MessageKey, values?: MessageValues) => string;

export function translator(locale: Locale): Translate {
  const messages = CATALOGS[locale];
  return (key, values) => formatMessage(messages[key], values, locale);
}

export const I18nContext = createContext<{ locale: Locale; t: Translate }>({ locale: "en", t: translator("en") });

export const useI18n = () => useContext(I18nContext);

export type { MessageKey };
