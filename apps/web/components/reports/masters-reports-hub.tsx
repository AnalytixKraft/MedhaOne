"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  Building2,
  ChartColumnBig,
  Package2,
  Search,
  Users2,
  type LucideIcon,
} from "lucide-react";

import { AppPageHeader, AppTabs } from "@/components/erp/app-primitives";
import { MastersNav } from "@/components/masters/masters-nav";
import { Input } from "@/components/ui/input";
import {
  MASTERS_REPORTS,
  MASTERS_REPORT_CATEGORIES,
  mastersReportsByCategory,
  type GenericReportConfig,
  type MastersReportCategoryId,
} from "@/lib/reports/navigation";
import { cn } from "@/lib/utils";

type TabId = "all" | MastersReportCategoryId;

// Reports introduced recently — flagged with a small "New" pill in the list.
const newSlugs = new Set(["rack-report", "party-directory", "item-directory"]);

type CategoryMeta = {
  id: MastersReportCategoryId;
  label: string;
  icon: LucideIcon;
  // Token-aware accent for the row icon chip and category pill (works in both
  // themes — mirrors the MetricCard accent pattern).
  tone: string;
  slugs: Set<string>;
};

// Icon + accent per category. Membership, labels, and order all come from the
// shared MASTERS_REPORT_CATEGORIES so the hub and the sidebar stay in sync.
const CATEGORY_UI: Record<MastersReportCategoryId, { icon: LucideIcon; tone: string }> = {
  parties: {
    icon: Users2,
    tone: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  items: {
    icon: Package2,
    tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  warehouse: {
    icon: Building2,
    tone: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  },
};

const CATEGORIES: CategoryMeta[] = MASTERS_REPORT_CATEGORIES.map((category) => ({
  id: category.id,
  label: category.label,
  icon: CATEGORY_UI[category.id].icon,
  tone: CATEGORY_UI[category.id].tone,
  slugs: new Set(category.slugs),
}));

function categoryOf(slug: string): CategoryMeta | null {
  return CATEGORIES.find((category) => category.slugs.has(slug)) ?? null;
}

function ReportRow({ report }: { report: GenericReportConfig }) {
  const category = categoryOf(report.slug);
  const Icon = category?.icon ?? ChartColumnBig;

  return (
    <Link
      href={report.href}
      data-testid={`masters-workspace-${report.slug}`}
      className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-[hsl(var(--table-row-hover))] md:px-5"
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition group-hover:scale-105",
          category?.tone,
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold leading-snug text-[hsl(var(--text-primary))]">
            {report.title}
          </h3>
          {newSlugs.has(report.slug) ? (
            <span className="rounded-full bg-[hsl(var(--primary))] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--primary-foreground))]">
              New
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-[hsl(var(--text-secondary))]">
          {report.description}
        </p>
      </div>
      {category ? (
        <span
          className={cn(
            "hidden shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] sm:inline-flex",
            category.tone,
          )}
        >
          {category.label}
        </span>
      ) : null}
      <ArrowRight className="h-4 w-4 shrink-0 text-[hsl(var(--text-secondary))] transition group-hover:translate-x-1 group-hover:text-[hsl(var(--text-primary))]" />
    </Link>
  );
}

export function MastersReportsHub({ showMastersNav = true }: { showMastersNav?: boolean }) {
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const result: Record<TabId, number> = {
      all: MASTERS_REPORTS.length,
      parties: 0,
      items: 0,
      warehouse: 0,
    };
    for (const category of CATEGORIES) {
      result[category.id] = MASTERS_REPORTS.filter((report) =>
        category.slugs.has(report.slug),
      ).length;
    }
    return result;
  }, []);

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "all", label: `All (${counts.all})` },
    ...CATEGORIES.map((category) => ({
      id: category.id,
      label: `${category.label} (${counts[category.id]})`,
    })),
  ];

  const visibleReports = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const scoped =
      activeTab === "all"
        ? CATEGORIES.flatMap((category) => mastersReportsByCategory(category.id))
        : mastersReportsByCategory(activeTab);
    if (!normalized) {
      return scoped;
    }
    return scoped.filter((report) =>
      `${report.title} ${report.description} ${report.slug}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [activeTab, query]);

  return (
    <div className="space-y-6">
      <AppPageHeader
        title="Masters Reports"
        description="Business visibility across warehouses, items, manufacturers, categories, and parties."
      />

      {showMastersNav ? <MastersNav /> : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <AppTabs
          tabs={tabs}
          value={activeTab}
          onChange={setActiveTab}
          className="w-full lg:w-auto"
        />
        <div className="relative w-full lg:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--text-secondary))]"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search reports…"
            aria-label="Search reports"
            className="pl-9"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card-bg))] shadow-sm">
        {visibleReports.length > 0 ? (
          <div className="divide-y divide-border/60">
            {visibleReports.map((report) => (
              <ReportRow key={report.slug} report={report} />
            ))}
          </div>
        ) : (
          <div className="px-4 py-14 text-center">
            <p className="text-sm font-medium text-[hsl(var(--text-primary))]">
              No reports match your search.
            </p>
            <p className="mt-1 text-sm text-[hsl(var(--text-secondary))]">
              Try a different term or switch tabs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
