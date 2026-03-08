import { type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TableWrapper } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type AppPageHeaderProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
};

export function AppPageHeader({
  title,
  description,
  actions,
  className,
}: AppPageHeaderProps) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between", className)}>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-[hsl(var(--text-primary))] md:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-3xl text-sm text-[hsl(var(--text-secondary))] md:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

type AppSectionCardProps = {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
};

export function AppSectionCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: AppSectionCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      {title || description || actions ? (
        <CardHeader className="border-b border-border/70 bg-[hsl(var(--muted-bg))]">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              {title ? <CardTitle className="text-xl text-[hsl(var(--text-primary))]">{title}</CardTitle> : null}
              {description ? <CardDescription>{description}</CardDescription> : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        </CardHeader>
      ) : null}
      <CardContent className={cn("space-y-4", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

export function FilterCard(props: AppSectionCardProps) {
  return <AppSectionCard {...props} className={cn("shadow-sm", props.className)} />;
}

type MetricCardProps = {
  title: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  accent?: "primary" | "success" | "warning" | "danger";
  className?: string;
};

const accentStyles = {
  primary: "bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  danger: "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
};

export function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  accent = "primary",
  className,
}: MetricCardProps) {
  return (
    <Card className={cn("shadow-sm", className)}>
      <CardContent className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">
            {title}
          </p>
          <p className="text-3xl font-semibold tracking-tight text-[hsl(var(--text-primary))]">
            {value}
          </p>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {Icon ? (
          <span className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", accentStyles[accent])}>
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}

type AppTabsProps<T extends string> = {
  tabs: Array<{ id: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

export function AppTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: AppTabsProps<T>) {
  return (
    <div className={cn("rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card-bg))] p-2 shadow-sm", className)}>
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
              value === tab.id
                ? "bg-foreground text-background shadow-sm"
                : "text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--muted-bg))] hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AppFormGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("grid gap-4 md:grid-cols-2 xl:grid-cols-4", className)}>{children}</div>;
}

export function AppActionBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-border bg-[hsl(var(--muted-bg))] p-4", className)}>
      {children}
    </div>
  );
}

export function AppSummaryPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("shadow-sm", className)}>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

type AppTableProps = {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function AppTable({
  title,
  description,
  actions,
  children,
  className,
}: AppTableProps) {
  return (
    <AppSectionCard
      title={title}
      description={description}
      actions={actions}
      className={className}
      contentClassName="space-y-0"
    >
      <TableWrapper>{children}</TableWrapper>
    </AppSectionCard>
  );
}

export function SecondaryActionLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Button asChild variant="outline" className={className}>
      <a href={href}>{children}</a>
    </Button>
  );
}
