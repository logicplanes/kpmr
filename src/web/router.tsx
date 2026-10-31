import { createContext, forwardRef, useContext, useEffect, useState, type ReactNode } from "react";
import type { LinkComponentProps } from "@logicplanes/kaeso-ui/utils";
import { LOCALES, type Locale } from "./i18n/index.ts";

export type Route =
  | { page: "overview" }
  | { page: "providers" }
  | { page: "provider"; provider: string }
  | { page: "model"; provider: string; model: string }
  | { page: "changes" }
  | { page: "format" }
  | { page: "not-found" };

export interface Location {
  locale: Locale;
  route: Route;
  path: string;
  search: URLSearchParams;
}

export function parseLocation(pathname: string, search = ""): Location {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const locale = (LOCALES as readonly string[]).includes(parts[0] ?? "") && parts[0] !== "en" ? (parts.shift() as Locale) : "en";
  const [first, second, ...rest] = parts;
  let route: Route = { page: "not-found" };
  if (!first) route = { page: "overview" };
  else if (first === "providers" && !second) route = { page: "providers" };
  else if (first === "providers" && second && rest.length === 0) route = { page: "provider", provider: second };
  else if (first === "models" && second && rest.length > 0) route = { page: "model", provider: second, model: rest.join("/") };
  else if (first === "changes" && !second) route = { page: "changes" };
  else if (first === "format" && !second) route = { page: "format" };
  return { locale, route, path: `/${parts.map(encodeURIComponent).join("/")}`.replace(/\/$/, "") || "/", search: new URLSearchParams(search) };
}

export function href(locale: Locale, path: string): string {
  const prefix = locale === "en" ? "" : `/${locale}`;
  return path === "/" ? prefix || "/" : `${prefix}${path}`;
}

export const modelPath = (provider: string, model: string) => `/models/${encodeURIComponent(provider)}/${model.split("/").map(encodeURIComponent).join("/")}`;
export const providerPath = (provider: string) => `/providers/${encodeURIComponent(provider)}`;

const LocationContext = createContext<Location>(parseLocation("/"));

export const useLocation = () => useContext(LocationContext);

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  if (!replace) document.getElementById("kpmr-main")?.scrollTo?.({ top: 0 });
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const read = () => parseLocation(window.location.pathname, window.location.search);
  const [location, setLocation] = useState(read);
  useEffect(() => {
    const update = () => setLocation(read());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return <LocationContext.Provider value={location}>{children}</LocationContext.Provider>;
}

const OUTSIDE = /^(?:[a-z]+:|\/\/|#)/i;

export const RouterLink = forwardRef<HTMLAnchorElement, LinkComponentProps>(function RouterLink({ href: to, onClick, target, children, ...props }, ref) {
  const inside = !OUTSIDE.test(to) && !target;
  return (
    <a
      ref={ref}
      href={to}
      target={target}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (!inside || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
});
