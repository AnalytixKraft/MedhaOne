"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Boxes,
  Building2,
  ChartColumnBig,
  ChevronDown,
  MapPinned,
  Package2,
  Users2,
  type LucideIcon,
} from "lucide-react";

import { AppPageHeader } from "@/components/erp/app-primitives";
import { MastersNav } from "@/components/masters/masters-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MASTERS_REPORTS, type GenericReportConfig } from "@/lib/reports/navigation";
import { cn } from "@/lib/utils";

type SectionTone = {
  badgeClassName: string;
  borderClassName: string;
  surfaceClassName: string;
  chipClassName: string;
};

type ReportSection = {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  tone: SectionTone;
  reports: GenericReportConfig[];
};

type SummaryCardConfig = {
  title: string;
  value: string;
  icon: LucideIcon;
  badgeClassName: string;
};

const warehouseSlugs = new Set([
  "current-stock",
  "warehouse-item-summary",
  "warehouse-utilization",
  "warehouse-coverage",
  "inactive-warehouses",
  "low-usage-unused-warehouses",
]);

const itemSlugs = new Set([
  "brand-item-report",
  "category-item-report",
  "item-utilization",
  "item-distribution",
  "brand-summary-report",
  "category-summary-report",
  "inactive-items",
]);

const partySlugs = new Set([
  "party-type-report",
  "party-geography-report",
  "party-commercial-report",
  "party-activity-report",
  "inactive-parties",
]);

const sections: ReportSection[] = [
  {
    id: "parties",
    title: "Party Reports",
    subtitle: "Business visibility for suppliers, customers, geography, commercial terms, and activity.",
    icon: Users2,
    tone: {
      badgeClassName:
        "bg-amber-100 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/12 dark:text-amber-200 dark:ring-amber-500/30",
      borderClassName:
        "border-amber-200/80 hover:border-amber-300 dark:border-amber-500/20 dark:hover:border-amber-400/40",
      surfaceClassName:
        "bg-gradient-to-br from-amber-50/90 via-white to-orange-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-amber-950/20",
      chipClassName:
        "bg-amber-100 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/12 dark:text-amber-200 dark:ring-amber-500/30",
    },
    reports: MASTERS_REPORTS.filter((report) => partySlugs.has(report.slug)),
  },
  {
    id: "items",
    title: "Item / Product Reports",
    subtitle: "Brand, category, distribution, and utilization visibility for the product master set.",
    icon: Package2,
    tone: {
      badgeClassName:
        "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/12 dark:text-emerald-200 dark:ring-emerald-500/30",
      borderClassName:
        "border-emerald-200/80 hover:border-emerald-300 dark:border-emerald-500/20 dark:hover:border-emerald-400/40",
      surfaceClassName:
        "bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-emerald-950/20",
      chipClassName:
        "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/12 dark:text-emerald-200 dark:ring-emerald-500/30",
    },
    reports: MASTERS_REPORTS.filter((report) => itemSlugs.has(report.slug)),
  },
  {
    id: "warehouse",
    title: "Warehouse Reports",
    subtitle: "Stock spread, warehouse usage, current holdings, and inactive location visibility.",
    icon: Building2,
    tone: {
      badgeClassName:
        "bg-sky-100 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/12 dark:text-sky-200 dark:ring-sky-500/30",
      borderClassName:
        "border-sky-200/80 hover:border-sky-300 dark:border-sky-500/20 dark:hover:border-sky-400/40",
      surfaceClassName:
        "bg-gradient-to-br from-sky-50/90 via-white to-indigo-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-sky-950/20",
      chipClassName:
        "bg-sky-100 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/12 dark:text-sky-200 dark:ring-sky-500/30",
    },
    reports: MASTERS_REPORTS.filter((report) => warehouseSlugs.has(report.slug)),
  },
];

const summaryCards: SummaryCardConfig[] = [
  {
    title: "Total Reports",
    value: String(MASTERS_REPORTS.length),
    icon: ChartColumnBig,
    badgeClassName:
      "bg-sky-100 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/12 dark:text-sky-200 dark:ring-sky-500/30",
  },
  {
    title: "Warehouse Reports",
    value: String(sections.find((section) => section.id === "warehouse")?.reports.length ?? 0),
    icon: Building2,
    badgeClassName:
      "bg-sky-100 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/12 dark:text-sky-200 dark:ring-sky-500/30",
  },
  {
    title: "Item Reports",
    value: String(sections.find((section) => section.id === "items")?.reports.length ?? 0),
    icon: Boxes,
    badgeClassName:
      "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/12 dark:text-emerald-200 dark:ring-emerald-500/30",
  },
  {
    title: "Party Reports",
    value: String(sections.find((section) => section.id === "parties")?.reports.length ?? 0),
    icon: MapPinned,
    badgeClassName:
      "bg-amber-100 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/12 dark:text-amber-200 dark:ring-amber-500/30",
  },
];

function SummaryTile({ title, value, icon: Icon, badgeClassName }: SummaryCardConfig) {
  return (
    <Card className="h-full">
      <CardContent className="flex min-h-[102px] items-center justify-between gap-4 p-5 md:p-6">
        <div className="flex min-w-0 flex-1 flex-col justify-center space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">
            {title}
          </p>
          <p className="text-3xl font-semibold tracking-tight text-[hsl(var(--text-primary))]">
            {value}
          </p>
        </div>
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-2xl ${badgeClassName}`}
        >
          <Icon className="h-5 w-5" />
        </span>
      </CardContent>
    </Card>
  );
}

type AccordionSectionProps = {
  section: ReportSection;
  expanded: boolean;
  onToggle: () => void;
};

export function AccordionSection({ section, expanded, onToggle }: AccordionSectionProps) {
  const SectionIcon = section.icon;

  return (
    <Card
      className={cn(
        "overflow-hidden border shadow-sm transition-all duration-300",
        section.tone.surfaceClassName,
        section.tone.borderClassName,
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left"
        aria-expanded={expanded}
      >
        <CardHeader className="border-b border-border/70 bg-white/70 backdrop-blur transition-colors hover:bg-white/90 dark:bg-slate-950/60 dark:hover:bg-slate-950/80">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${section.tone.badgeClassName}`}
                >
                  <SectionIcon className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  <CardTitle className="text-xl text-[hsl(var(--text-primary))]">
                    {section.title}
                  </CardTitle>
                  <p className="max-w-3xl text-sm text-[hsl(var(--text-secondary))]">
                    {section.subtitle}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${section.tone.chipClassName}`}
              >
                {section.reports.length} reports
              </span>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border/70 bg-white/80 text-[hsl(var(--text-secondary))] dark:bg-slate-950/70">
                <ChevronDown
                  className={cn(
                    "h-5 w-5 transition-transform duration-300",
                    expanded ? "rotate-180" : "rotate-0",
                  )}
                />
              </span>
            </div>
          </div>
        </CardHeader>
      </button>

      <div
        className={cn(
          "grid transition-all duration-300 ease-out",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <CardContent className="p-5 md:p-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {section.reports.map((report) => (
                <Link
                  key={report.href}
                  href={report.href}
                  data-testid={`masters-workspace-${report.slug}`}
                  className="group block h-full"
                >
                  <Card
                    className={`h-full border shadow-sm transition duration-200 group-hover:-translate-y-1 group-hover:shadow-lg ${section.tone.borderClassName}`}
                  >
                    <CardContent className="flex min-h-[206px] h-full flex-col p-5">
                      <div className="flex items-start justify-between gap-3">
                        <span
                          className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl transition group-hover:scale-105 ${section.tone.badgeClassName}`}
                        >
                          <SectionIcon className="h-4.5 w-4.5" />
                        </span>
                        <ArrowRight className="h-4.5 w-4.5 text-[hsl(var(--text-secondary))] transition group-hover:translate-x-1 group-hover:text-[hsl(var(--text-primary))]" />
                      </div>
                      <div className="flex flex-1 flex-col justify-start pt-4">
                        <div className="space-y-2">
                          <h3 className="text-base font-semibold leading-snug text-[hsl(var(--text-primary))]">
                            {report.title}
                          </h3>
                          <p className="text-sm leading-6 text-[hsl(var(--text-secondary))]">
                            {report.description}
                          </p>
                        </div>
                      </div>
                      <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${section.tone.chipClassName}`}
                        >
                          Open report
                        </span>
                        <span className="text-xs text-[hsl(var(--text-secondary))]">
                          View details
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </CardContent>
        </div>
      </div>
    </Card>
  );
}

export function MastersReportsHub({ showMastersNav = true }: { showMastersNav?: boolean }) {
  const [activeSectionId, setActiveSectionId] = useState<string | null>(sections[0]?.id ?? null);

  return (
    <div className="space-y-6">
      <AppPageHeader
        title="Masters Reports"
        description="Business visibility across warehouses, items, brands, categories, and parties."
      />

      {showMastersNav ? <MastersNav /> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <SummaryTile key={card.title} {...card} />
        ))}
      </div>

      <div className="space-y-4">
        {sections.map((section) => (
          <AccordionSection
            key={section.id}
            section={section}
            expanded={section.id === activeSectionId}
            onToggle={() => {
              setActiveSectionId((current) => (current === section.id ? null : section.id));
            }}
          />
        ))}
      </div>
    </div>
  );
}
