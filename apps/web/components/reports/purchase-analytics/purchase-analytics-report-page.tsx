"use client";

import {
  BarChart,
  Bar,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BadgePercent,
  Boxes,
  Clock3,
  Download,
  LineChart as LineChartIcon,
  PackageCheck,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AppSectionCard, AppTable, MetricCard } from "@/components/erp/app-primitives";
import { PageTitle } from "@/components/layout/page-title";
import { PurchaseAnalyticsFilterBar, defaultPurchaseAnalyticsFilters, type PurchaseAnalyticsFilterState } from "@/components/reports/purchase-analytics/filter-bar";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  apiClient,
  type PurchaseAnalyticsFilterOptions,
  type PurchaseAnalyticsReportResponse,
  type ReportSummaryMetric,
} from "@/lib/api/client";
import { PURCHASE_ANALYTICS_REPORTS } from "@/lib/reports/navigation";

type PurchaseAnalyticsSlug =
  | "purchase-cost-trend"
  | "seasonal-purchase-pattern"
  | "supplier-lead-time"
  | "supplier-price-comparison"
  | "po-fulfillment-quality";

const metricIcons = [LineChartIcon, Clock3, BadgePercent, Boxes, PackageCheck];

function exportRows(
  filename: string,
  headers: string[],
  rows: Array<Record<string, string | number | boolean | null>>,
  format: "csv" | "xls",
) {
  if (rows.length === 0) {
    return;
  }

  if (format === "csv") {
    const lines = [
      headers.join(","),
      ...rows.map((row) =>
        headers
          .map((header) => `"${String(row[header] ?? "").replaceAll('"', '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  const html = `
    <table>
      <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows
          .map(
            (row) =>
              `<tr>${headers.map((header) => `<td>${String(row[header] ?? "")}</td>`).join("")}</tr>`,
          )
          .join("")}
      </tbody>
    </table>
  `;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function printRows(title: string, headers: string[], rows: Array<Record<string, string | number | boolean | null>>) {
  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) {
    return;
  }
  popup.document.write(`
    <html>
      <head><title>${title}</title></head>
      <body>
        <h1>${title}</h1>
        <table border="1" cellspacing="0" cellpadding="8">
          <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows
              .map(
                (row) =>
                  `<tr>${headers.map((header) => `<td>${String(row[header] ?? "")}</td>`).join("")}</tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `);
  popup.document.close();
  popup.print();
}

function buildQuery(filters: PurchaseAnalyticsFilterState) {
  return {
    product_ids: filters.productIds.join(",") || undefined,
    brand_values: filters.brandValues.join(",") || undefined,
    category_values: filters.categoryValues.join(",") || undefined,
    supplier_ids: filters.supplierIds.join(",") || undefined,
    warehouse_ids: filters.warehouseIds.join(",") || undefined,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
    year: filters.year || undefined,
    month: filters.month || undefined,
  };
}

function formatCell(value: string | number | boolean | null | undefined) {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

function renderHeatmap(
  rows: Array<Record<string, string | number | boolean | null>>,
  monthColumns: Array<{ key: string; label: string }>,
) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[920px] space-y-2">
        <div className="grid grid-cols-[220px_repeat(12,minmax(64px,1fr))] gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <div>Product</div>
          {monthColumns.map((column) => (
            <div key={column.key} className="text-center">
              {column.label}
            </div>
          ))}
        </div>
        {rows.map((row, index) => (
          <div key={`heatmap-${index}`} className="grid grid-cols-[220px_repeat(12,minmax(64px,1fr))] gap-2">
            <div className="rounded-xl border border-border/70 bg-[hsl(var(--surface-elevated))] px-3 py-2 text-sm">
              {formatCell(row.product)}<div className="text-xs text-muted-foreground">{formatCell(row.brand)}</div>
            </div>
            {monthColumns.map((column) => {
              const value = Number(row[column.key] ?? 0);
              const opacity = Math.min(Math.max(value / 100, 0.08), 1);
              return (
                <div
                  key={`${index}-${column.key}`}
                  className="flex h-14 items-center justify-center rounded-xl border border-border/60 text-sm font-medium text-slate-900"
                  style={{ backgroundColor: `rgba(14, 165, 233, ${opacity})` }}
                >
                  {value > 0 ? value : "-"}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderCharts(slug: PurchaseAnalyticsSlug, payload: PurchaseAnalyticsReportResponse) {
  const lineKeys = Array.isArray(payload.meta.line_keys)
    ? (payload.meta.line_keys as Array<{ key: string; label: string }>)
    : [];
  const monthColumns = Array.isArray(payload.meta.month_columns)
    ? (payload.meta.month_columns as Array<{ key: string; label: string }>)
    : [];

  if (slug === "purchase-cost-trend") {
    return (
      <AppSectionCard title="Trend Line" description="Purchase rate trend by month using posted bill cost or GRN fallback.">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={payload.charts.trend ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              {lineKeys.map((line, index) => (
                <Line
                  key={line.key}
                  type="monotone"
                  dataKey={line.key}
                  name={line.label}
                  stroke={["#0284c7", "#16a34a", "#d97706", "#dc2626"][index % 4]}
                  strokeWidth={2}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </AppSectionCard>
    );
  }

  if (slug === "seasonal-purchase-pattern") {
    return (
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <AppSectionCard title="Month-wise Demand Curve" description="Month-wise bar chart for purchase quantity.">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={payload.charts.bar ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="purchase_qty" fill="#0284c7" name="Purchase Qty" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </AppSectionCard>
        <AppSectionCard title="Seasonality Heatmap" description="Heatmap of purchase quantity by product and month.">
          {renderHeatmap(payload.charts.heatmap ?? [], monthColumns)}
        </AppSectionCard>
      </div>
    );
  }

  if (slug === "supplier-lead-time") {
    return (
      <div className="grid gap-6 xl:grid-cols-2">
        <AppSectionCard title="Lead Time by Supplier" description="Average days from PO creation to first receipt.">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={payload.charts.bar ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="supplier" hide />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="avg_days_to_first_grn" fill="#0284c7" name="Avg Days to First GRN" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </AppSectionCard>
        <AppSectionCard title="Lead Time vs Quantity" description="Scatter view of supplier lead time against received quantity.">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="total_received_qty" name="Total Received Qty" />
                <YAxis dataKey="avg_days_to_first_grn" name="Avg Days to First GRN" />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                <Scatter data={payload.charts.scatter ?? []} fill="#16a34a" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </AppSectionCard>
      </div>
    );
  }

  if (slug === "supplier-price-comparison") {
    return (
      <div className="grid gap-6 xl:grid-cols-2">
        <AppSectionCard title="Comparison Bar Chart" description="Supplier average purchase rate comparison.">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={payload.charts.bar ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="supplier" hide />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="avg_purchase_rate" fill="#d97706" name="Avg Purchase Rate" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </AppSectionCard>
        <AppSectionCard title="Supplier Rate Trend" description="Optional over-time supplier comparison for selected products.">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={payload.charts.trend ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                {lineKeys.map((line, index) => (
                  <Line
                    key={line.key}
                    type="monotone"
                    dataKey={line.key}
                    name={line.label}
                    stroke={["#0284c7", "#16a34a", "#d97706", "#dc2626"][index % 4]}
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </AppSectionCard>
      </div>
    );
  }

  return (
    <AppSectionCard title="Fulfillment Ranking" description="Supplier ranking by fill rate and receipt fragmentation.">
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={payload.charts.bar ?? []}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="supplier" hide />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="fill_rate_pct" fill="#16a34a" name="Fill Rate %" radius={[8, 8, 0, 0]} />
            <Bar dataKey="partial_receipt_frequency" fill="#dc2626" name="Partial Receipt Frequency" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </AppSectionCard>
  );
}

export function PurchaseAnalyticsReportPage({ slug }: { slug: PurchaseAnalyticsSlug }) {
  const config = PURCHASE_ANALYTICS_REPORTS.find((report) => report.slug === slug);
  const [filterOptions, setFilterOptions] = useState<PurchaseAnalyticsFilterOptions>({
    brands: [],
    categories: [],
    batches: [],
    products: [],
    suppliers: [],
    warehouses: [],
    years: [],
  });
  const [draftFilters, setDraftFilters] = useState<PurchaseAnalyticsFilterState>(defaultPurchaseAnalyticsFilters);
  const [appliedFilters, setAppliedFilters] = useState<PurchaseAnalyticsFilterState>(defaultPurchaseAnalyticsFilters);
  const [payload, setPayload] = useState<PurchaseAnalyticsReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!config) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const query = buildQuery(appliedFilters);
      const response =
        slug === "purchase-cost-trend"
          ? await apiClient.getPurchaseCostTrendReport(query)
          : slug === "seasonal-purchase-pattern"
            ? await apiClient.getSeasonalPurchasePatternReport(query)
            : slug === "supplier-lead-time"
              ? await apiClient.getSupplierLeadTimeReport(query)
              : slug === "supplier-price-comparison"
                ? await apiClient.getSupplierPriceComparisonReport(query)
                : await apiClient.getPoFulfillmentQualityReport(query);
      setPayload(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, config, slug]);

  useEffect(() => {
    void apiClient.getPurchaseAnalyticsFilterOptions().then(setFilterOptions);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const headers = useMemo(() => config?.columns?.map((column) => column.key) ?? [], [config]);
  const rows = payload?.data ?? [];
  const summary = payload?.summary ?? [];

  if (!config) {
    return <p className="text-sm text-red-500">Purchase analytics report configuration not found.</p>;
  }

  return (
    <div className="space-y-6">
      <PageTitle title={config.title} description={config.description} />

      <PurchaseAnalyticsFilterBar
        options={filterOptions}
        value={draftFilters}
        onChange={setDraftFilters}
        onApply={() => setAppliedFilters(draftFilters)}
        onClear={() => {
          setDraftFilters(defaultPurchaseAnalyticsFilters);
          setAppliedFilters(defaultPurchaseAnalyticsFilters);
        }}
        onExportCsv={() => exportRows(`${config.slug}.csv`, headers, rows, "csv")}
        onExportExcel={() => exportRows(`${config.slug}.xls`, headers, rows, "xls")}
        onPrint={() => printRows(config.title, headers, rows)}
        showYearFilter={slug === "seasonal-purchase-pattern"}
        showMonthFilter={slug === "seasonal-purchase-pattern"}
      />

      {summary.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {summary.map((metric: ReportSummaryMetric, index) => {
            const Icon = metricIcons[index % metricIcons.length];
            return (
              <MetricCard
                key={metric.key}
                title={metric.label}
                value={formatCell(metric.value)}
                icon={Icon}
                accent={index % 2 === 0 ? "primary" : "success"}
              />
            );
          })}
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading purchase analytics...</p> : renderCharts(slug, payload ?? { total: 0, page: 1, page_size: 50, summary: [], charts: {}, data: [], meta: {} })}

      <AppTable
        title="Detailed Table"
        description="Report rows aligned to the selected procurement filters."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => exportRows(`${config.slug}.csv`, headers, rows, "csv")}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <Button type="button" variant="outline" onClick={() => exportRows(`${config.slug}.xls`, headers, rows, "xls")}>
              <Download className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
            <Button type="button" variant="outline" onClick={() => void load()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        }
      >
        <Table>
          <TableHeader className="bg-[hsl(var(--table-header-bg))]">
            <TableRow>
              {config.columns?.map((column) => (
                <TableHead key={column.key}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={`${config.slug}-${index}`}>
                {config.columns?.map((column) => (
                  <TableCell key={column.key}>{formatCell(row[column.key])}</TableCell>
                ))}
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={config.columns?.length ?? 1} className="py-8 text-center text-sm text-muted-foreground">
                  No records found for this report.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </AppTable>
    </div>
  );
}
