import type { ReactNode } from "react";
import { Text } from "@logicplanes/kaeso-ui";
import { RouterLink } from "./router.tsx";

const COLUMNS = { 2: "cells-2", 3: "cells-3", 4: "cells-4" } as const;

export function Cells({ columns, children, label }: { columns: keyof typeof COLUMNS; children: ReactNode; label?: string }) {
  return (
    <div role={label ? "list" : undefined} aria-label={label} className={COLUMNS[columns]}>
      {children}
    </div>
  );
}

export function Cell({ children }: { children: ReactNode }) {
  return <section className="flex min-w-0 flex-col gap-8 bg-panel p-24">{children}</section>;
}

export function LinkCell({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <RouterLink
      href={href}
      role="listitem"
      aria-label={label}
      className="group/cell flex min-h-160 min-w-0 flex-col justify-between gap-16 bg-panel p-24 transition-control hover:bg-item-hover focus-ring"
    >
      {children}
    </RouterLink>
  );
}

export function Metric({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <Cell>
      <Text variant="small" tone="secondary">
        {label}
      </Text>
      <Text variant="metric">{value}</Text>
    </Cell>
  );
}

export function HeaderTitle({ title, count }: { title: ReactNode; count?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-baseline gap-8">
      <span className="truncate">{title}</span>
      {count !== undefined && (
        <Text as="span" variant="caption" tone="tertiary" tabular>
          {count}
        </Text>
      )}
    </span>
  );
}
