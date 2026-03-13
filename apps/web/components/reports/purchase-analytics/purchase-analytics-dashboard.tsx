"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgePercent,
  CalendarRange,
  CircleDollarSign,
  Clock3,
  PackageCheck,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { AppPageHeader } from "@/components/erp/app-primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiClient, type PurchaseAnalyticsDashboardResponse } from "@/lib/api/client";
import { PURCHASE_ANALYTICS_REPORTS, type GenericReportConfig } from "@/lib/reports/navigation";
import { cn } from "@/lib/utils";

type AccentTone = {
  badgeClassName: string;
  borderClassName: string;
  surfaceClassName: string;
  chipClassName: string;
  metricGlowClassName: string;
  accentBarClassName: string;
};

type MetricConfig = {
  key: string;
  icon: LucideIcon;
  accent: AccentTone;
  helper: string;
};

type ReportSection = {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  tone: AccentTone;
  reportSlugs: string[];
  placeholder?: {
    title: string;
    description: string;
  };
};

type SectionReport = GenericReportConfig & {
  icon: LucideIcon;
  isPopular?: boolean;
};

const blueTone: AccentTone = {
  badgeClassName:
    "bg-sky-100 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/12 dark:text-sky-200 dark:ring-sky-500/30",
  borderClassName:
    "border-sky-200/80 hover:border-sky-300 dark:border-sky-500/20 dark:hover:border-sky-400/40",
  surfaceClassName:
    "bg-gradient-to-br from-sky-50/90 via-white to-indigo-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-sky-950/25",
  chipClassName:
    "bg-sky-100 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/12 dark:text-sky-200 dark:ring-sky-500/30",
  metricGlowClassName:
    "from-sky-500/20 via-sky-400/5 to-transparent dark:from-sky-400/20 dark:via-sky-400/5 dark:to-transparent",
  accentBarClassName: "from-sky-500 via-indigo-500 to-sky-400",
};

const greenTone: AccentTone = {
  badgeClassName:
    "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/12 dark:text-emerald-200 dark:ring-emerald-500/30",
  borderClassName:
    "border-emerald-200/80 hover:border-emerald-300 dark:border-emerald-500/20 dark:hover:border-emerald-400/40",
  surfaceClassName:
    "bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-emerald-950/25",
  chipClassName:
    "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/12 dark:text-emerald-200 dark:ring-emerald-500/30",
  metricGlowClassName:
    "from-emerald-500/20 via-emerald-400/5 to-transparent dark:from-emerald-400/20 dark:via-emerald-400/5 dark:to-transparent",
  accentBarClassName: "from-emerald-500 via-teal-500 to-emerald-400",
};

const indigoTone: AccentTone = {
  badgeClassName:
    "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-500/12 dark:text-indigo-200 dark:ring-indigo-500/30",
  borderClassName:
    "border-indigo-200/80 hover:border-indigo-300 dark:border-indigo-500/20 dark:hover:border-indigo-400/40",
  surfaceClassName:
    "bg-gradient-to-br from-indigo-50/90 via-white to-violet-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950/25",
  chipClassName:
    "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-500/12 dark:text-indigo-200 dark:ring-indigo-500/30",
  metricGlowClassName:
    "from-indigo-500/20 via-indigo-400/5 to-transparent dark:from-indigo-400/20 dark:via-indigo-400/5 dark:to-transparent",
  accentBarClassName: "from-indigo-500 via-violet-500 to-indigo-400",
};

const tealTone: AccentTone = {
  badgeClassName:
    "bg-teal-100 text-teal-700 ring-1 ring-teal-200 dark:bg-teal-500/12 dark:text-teal-200 dark:ring-teal-500/30",
  borderClassName:
    "border-teal-200/80 hover:border-teal-300 dark:border-teal-500/20 dark:hover:border-teal-400/40",
  surfaceClassName:
    "bg-gradient-to-br from-teal-50/90 via-white to-cyan-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-teal-950/25",
  chipClassName:
    "bg-teal-100 text-teal-700 ring-1 ring-teal-200 dark:bg-teal-500/12 dark:text-teal-200 dark:ring-teal-500/30",
  metricGlowClassName:
    "from-teal-500/20 via-teal-400/5 to-transparent dark:from-teal-400/20 dark:via-teal-400/5 dark:to-transparent",
  accentBarClassName: "from-teal-500 via-cyan-500 to-teal-400",
};

const amberTone: AccentTone = {
  badgeClassName:
    "bg-amber-100 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/12 dark:text-amber-200 dark:ring-amber-500/30",
  borderClassName:
    "border-amber-200/80 hover:border-amber-300 dark:border-amber-500/20 dark:hover:border-amber-400/40",
  surfaceClassName:
    "bg-gradient-to-br from-amber-50/90 via-white to-orange-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-amber-950/25",
  chipClassName:
    "bg-amber-100 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/12 dark:text-amber-200 dark:ring-amber-500/30",
  metricGlowClassName:
    "from-amber-500/20 via-amber-400/5 to-transparent dark:from-amber-400/20 dark:via-amber-400/5 dark:to-transparent",
  accentBarClassName: "from-amber-500 via-orange-500 to-violet-500",
};

const metricConfigByKey: Record<string, MetricConfig> = {
  total_purchase_value: {
    key: "total_purchase_value",
    icon: CircleDollarSign,
    accent: blueTone,
    helper: "Posted commercial value across purchase activity.",
  },
  avg_purchase_lead_time: {
    key: "avg_purchase_lead_time",
    icon: Clock3,
    accent: greenTone,
    helper: "Average turnaround from PO creation to receipt.",
  },
  products_with_strong_seasonality: {
    key: "products_with_strong_seasonality",
    icon: CalendarRange,
    accent: indigoTone,
    helper: "Products showing concentrated buying months.",
  },
  suppliers_with_best_price: {
    key: "suppliers_with_best_price",
    icon: BadgePercent,
    accent: tealTone,
    helper: "Best current price leader across tracked products.",
  },
  suppliers_with_best_fill_rate: {
    key: "suppliers_with_best_fill_rate",
    icon: PackageCheck,
    accent: greenTone,
    helper: "Suppliers delivering the cleanest PO fulfillment.",
  },
};

const reportIconBySlug: Record<string, LucideIcon> = {
  "purchase-cost-trend": TrendingUp,
  "supplier-price-comparison": BadgePercent,
  "supplier-lead-time": Clock3,
  "po-fulfillment-quality": PackageCheck,
  "seasonal-purchase-pattern": CalendarRange,
};

const popularReportSlugs = new Set(["purchase-cost-trend", "supplier-lead-time"]);

const sections: ReportSection[] = [
  {
    id: "pricing",
    title: "Pricing Analytics",
    subtitle: "Track purchase cost movement, price spreads, and supplier price positioning over time.",
    icon: CircleDollarSign,
    tone: blueTone,
    reportSlugs: ["purchase-cost-trend", "supplier-price-comparison"],
  },
  {
    id: "supplier-performance",
    title: "Supplier Performance",
    subtitle: "Compare responsiveness, receipt quality, and fulfillment behavior across suppliers.",
    icon: PackageCheck,
    tone: greenTone,
    reportSlugs: ["supplier-lead-time", "po-fulfillment-quality"],
  },
  {
    id: "planning",
    title: "Purchase Planning",
    subtitle: "Spot buying cycles, seasonal concentration, and future planning opportunities.",
    icon: Sparkles,
    tone: amberTone,
    reportSlugs: ["seasonal-purchase-pattern"],
    placeholder: {
      title: "More Planning Reports",
      description: "Purchase frequency, supplier dependency, and procurement health can expand here next.",
    },
  },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMetricValue(metric: PurchaseAnalyticsDashboardResponse["summary"][number]) {
  const value = metric.value;

  if (metric.key === "total_purchase_value" && typeof value === "number") {
    return formatCurrency(value);
  }
  if (metric.key === "avg_purchase_lead_time" && typeof value === "number") {
    return `${value} days`;
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

function SummaryTile({
  metric,
}: {
  metric: PurchaseAnalyticsDashboardResponse["summary"][number] & { config: MetricConfig };
}) {
  const Icon = metric.config.icon;
  return (
    <Card
      className={cn(
        "group relative overflow-hidden border shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg",
        metric.config.accent.borderClassName,
      )}
    >
      <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", metric.config.accent.accentBarClassName)} />
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-80",
          metric.config.accent.metricGlowClassName,
        )}
      />
      <CardContent className="relative flex min-h-[132px] items-start justify-between gap-4 p-5 md:p-6">
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">
            {metric.label}
          </p>
          <p className="text-3xl font-semibold tracking-tight text-[hsl(var(--text-primary))] md:text-[2rem]">
            {formatMetricValue(metric)}
          </p>
          <p className="max-w-[28ch] text-sm leading-6 text-[hsl(var(--text-secondary))]">
            {metric.config.helper}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition group-hover:scale-105",
            metric.config.accent.badgeClassName,
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
      </CardContent>
    </Card>
  );
}

function ReportCard({
  report,
  tone,
}: {
  report: SectionReport;
  tone: AccentTone;
}) {
  const Icon = report.icon;

  return (
    <Link href={report.href} className="group block h-full" data-testid={report.testId}>
      <Card
        className={cn(
          "h-full border shadow-sm transition duration-200 group-hover:-translate-y-1 group-hover:shadow-lg",
          tone.borderClassName,
        )}
      >
        <CardContent className="flex min-h-[214px] h-full flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex h-11 w-11 items-center justify-center rounded-2xl transition group-hover:scale-105",
                  tone.badgeClassName,
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              {report.isPopular ? (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
                    tone.chipClassName,
                  )}
                >
                  Most used
                </span>
              ) : null}
            </div>
            <ArrowRight className="h-4.5 w-4.5 text-[hsl(var(--text-secondary))] transition group-hover:translate-x-1 group-hover:text-[hsl(var(--text-primary))]" />
          </div>

          <div className="flex-1 space-y-2 pt-4">
            <h3 className="text-lg font-semibold leading-snug text-[hsl(var(--text-primary))]">
              {report.title}
            </h3>
            <p className="text-sm leading-6 text-[hsl(var(--text-secondary))]">
              {report.description}
            </p>
          </div>

          <div className="mt-auto flex items-center justify-between gap-3 pt-5">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
                tone.chipClassName,
              )}
            >
              Open report
            </span>
            <span className="text-xs text-[hsl(var(--text-secondary))]">View details</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function PlaceholderCard({ tone, title, description }: { tone: AccentTone; title: string; description: string }) {
  return (
    <Card
      className={cn(
        "h-full border border-dashed shadow-sm",
        tone.borderClassName.replaceAll("hover:", ""),
      )}
    >
      <CardContent className="flex min-h-[214px] h-full flex-col justify-between p-5">
        <div className="space-y-4">
          <span
            className={cn(
              "inline-flex h-11 w-11 items-center justify-center rounded-2xl",
              tone.badgeClassName,
            )}
          >
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-[hsl(var(--text-primary))]">{title}</h3>
            <p className="text-sm leading-6 text-[hsl(var(--text-secondary))]">{description}</p>
          </div>
        </div>
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">
          Coming soon
        </span>
      </CardContent>
    </Card>
  );
}

function SectionBlock({
  section,
  reports,
}: {
  section: ReportSection;
  reports: SectionReport[];
}) {
  const SectionIcon = section.icon;
  const totalCards = reports.length + (section.placeholder ? 1 : 0);

  return (
    <Card
      className={cn(
        "overflow-hidden border shadow-sm",
        section.tone.surfaceClassName,
        section.tone.borderClassName.replaceAll("hover:", ""),
      )}
    >
      <div className={cn("h-1.5 w-full bg-gradient-to-r", section.tone.accentBarClassName)} />
      <CardHeader className="border-b border-border/70 bg-white/75 backdrop-blur dark:bg-slate-950/60">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={cn(
                  "inline-flex h-11 w-11 items-center justify-center rounded-2xl",
                  section.tone.badgeClassName,
                )}
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

          <span
            className={cn(
              "inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
              section.tone.chipClassName,
            )}
          >
            {totalCards} cards
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-5 md:p-6">
        <div className="grid gap-4 md:grid-cols-2">
          {reports.map((report) => (
            <ReportCard key={report.slug} report={report} tone={section.tone} />
          ))}
          {section.placeholder ? (
            <PlaceholderCard
              tone={section.tone}
              title={section.placeholder.title}
              description={section.placeholder.description}
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function PurchaseAnalyticsDashboard() {
  const [summary, setSummary] = useState<PurchaseAnalyticsDashboardResponse["summary"]>([]);

  useEffect(() => {
    void apiClient.getPurchaseAnalyticsDashboard().then((response) => {
      setSummary(response.summary);
    });
  }, []);

  const metrics = useMemo(() => {
    const metricMap = new Map(summary.map((metric) => [metric.key, metric]));
    return Object.values(metricConfigByKey).map((config) => ({
      key: config.key,
      label: metricMap.get(config.key)?.label ?? config.key,
      value: metricMap.get(config.key)?.value ?? "-",
      config,
    }));
  }, [summary]);

  const groupedReports = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        reports: PURCHASE_ANALYTICS_REPORTS.filter((report) =>
          section.reportSlugs.includes(report.slug),
        ).map((report) => ({
          ...report,
          icon: reportIconBySlug[report.slug] ?? TrendingUp,
          isPopular: popularReportSlugs.has(report.slug),
        })),
      })),
    [],
  );

  return (
    <div className="space-y-6">
      <AppPageHeader
        title="Purchase Analytics"
        description="Procurement intelligence for pricing, supplier responsiveness, seasonality, and purchase fulfillment quality."
      />

      <Card className="border-border/80 bg-[hsl(var(--card-bg))] shadow-sm">
        <CardContent className="space-y-1 p-5 md:p-6">
          <p className="text-sm text-[hsl(var(--text-secondary))]">
            Track cost movement, supplier performance, and buying trends across products and warehouses.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <SummaryTile key={metric.key} metric={metric} />
        ))}
      </div>

      <div className="space-y-5">
        {groupedReports.map((section) => (
          <SectionBlock key={section.id} section={section} reports={section.reports} />
        ))}
      </div>
    </div>
  );
}
