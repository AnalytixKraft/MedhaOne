import { type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shared master-form primitives. Extracted so the Product Master form matches the
 * Party Master form look. Party still keeps its own local copies for now; this is
 * the canonical version other master screens should adopt.
 */

export function FieldShell({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="space-y-2">
      <div className="space-y-1">
        <p className="text-sm font-medium text-[hsl(var(--text-primary))]">{label}</p>
        {hint ? <p className="text-xs text-[hsl(var(--text-secondary))]">{hint}</p> : null}
      </div>
      {children}
      {error ? <p className="text-xs text-rose-700 dark:text-rose-400">{error}</p> : null}
    </label>
  );
}

export function NativeSelect({
  value,
  onChange,
  children,
  disabled,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      data-testid={testId}
      onChange={(event) => onChange(event.target.value)}
      className="flex h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </select>
  );
}

export function FormSection({
  title,
  description,
  collapsible = true,
  defaultOpen = true,
  children,
}: {
  title: string;
  description?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const cardClass =
    "overflow-hidden rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card-bg))] text-card-foreground shadow-sm";
  const heading = (
    <div className="space-y-0.5">
      <h3 className="text-base font-semibold text-[hsl(var(--text-primary))]">{title}</h3>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
  const body = <div className="space-y-4 p-5 pt-4 md:p-6 md:pt-4">{children}</div>;

  if (!collapsible) {
    return (
      <div className={cardClass}>
        <div className="border-b border-border/70 bg-[hsl(var(--muted-bg))] px-5 py-3 md:px-6">
          {heading}
        </div>
        {body}
      </div>
    );
  }

  return (
    <details open={defaultOpen} className={cn("group", cardClass)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 border-b border-transparent bg-[hsl(var(--muted-bg))] px-5 py-3 group-open:border-border/70 md:px-6 [&::-webkit-details-marker]:hidden">
        {heading}
        <ChevronDown
          className="h-4 w-4 shrink-0 text-[hsl(var(--text-secondary))] transition-transform duration-200 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      {body}
    </details>
  );
}
