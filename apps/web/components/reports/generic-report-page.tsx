"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AppTable, MetricCard } from "@/components/erp/app-primitives";
import { PageTitle } from "@/components/layout/page-title";
import {
  DataQualityFilterBar,
  defaultDataQualityFilters,
  type DataQualityFilterState,
} from "@/components/reports/master-data-filter-bars";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  apiClient,
  type DataQualityFilterOptions,
  type GenericTabularReportResponse,
} from "@/lib/api/client";
import { type GenericReportConfig } from "@/lib/reports/navigation";

function cloneDataQualityFilters(filters: DataQualityFilterState): DataQualityFilterState {
  return {
    ...filters,
    entityTypes: [...filters.entityTypes],
  };
}

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
              `<tr>${headers
                .map((header) => `<td>${String(row[header] ?? "")}</td>`)
                .join("")}</tr>`,
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

function metricAccent(index: number) {
  return ["primary", "success", "warning", "danger"][index % 4] as
    | "primary"
    | "success"
    | "warning"
    | "danger";
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

export function GenericMasterReportPage({ config }: { config: GenericReportConfig }) {
  const [rows, setRows] = useState<Array<Record<string, string | number | boolean | null>>>([]);
  const [summary, setSummary] = useState<GenericTabularReportResponse["summary"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!config.endpoint) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.getGenericReport(config.endpoint);
      setRows(response.data);
      setSummary(response.summary);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [config.endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  const headers = useMemo(() => config.columns?.map((column) => column.key) ?? [], [config.columns]);

  return (
    <div className="space-y-6">
      <PageTitle title={config.title} description={config.description} />
      {summary.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {summary.map((metric, index) => (
            <MetricCard
              key={metric.key}
              title={metric.label}
              value={String(metric.value ?? 0)}
              accent={metricAccent(index)}
            />
          ))}
        </div>
      ) : null}
      <AppTable
        title={config.title}
        description={config.description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => exportRows(`${config.slug}.csv`, headers, rows, "csv")}>
              Export CSV
            </Button>
            <Button type="button" variant="outline" onClick={() => exportRows(`${config.slug}.xls`, headers, rows, "xls")}>
              Export Excel
            </Button>
            <Button type="button" variant="outline" onClick={() => printRows(config.title, headers, rows)}>
              Print
            </Button>
            <Button type="button" variant="outline" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        }
      >
        {error ? <p className="p-4 text-sm text-red-500">{error}</p> : null}
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading report...</p>
        ) : (
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
                    <TableCell key={column.key}>{String(row[column.key] ?? "-")}</TableCell>
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
        )}
      </AppTable>
    </div>
  );
}

export function GenericDataQualityReportPage({ config }: { config: GenericReportConfig }) {
  const [rows, setRows] = useState<Array<Record<string, string | number | boolean | null>>>([]);
  const [summary, setSummary] = useState<GenericTabularReportResponse["summary"]>([]);
  const [filterOptions, setFilterOptions] = useState<DataQualityFilterOptions | null>(null);
  const [draftFilters, setDraftFilters] = useState<DataQualityFilterState>(defaultDataQualityFilters);
  const [appliedFilters, setAppliedFilters] = useState<DataQualityFilterState>(defaultDataQualityFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!config.endpoint) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.getGenericReport(config.endpoint, {
        entity_types: appliedFilters.entityTypes.join(",") || undefined,
        missing_field_type: appliedFilters.missingFieldType || undefined,
        duplicate_type: appliedFilters.duplicateType || undefined,
        compliance_type: appliedFilters.complianceType || undefined,
      });
      setRows(response.data);
      setSummary(response.summary);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, config.endpoint]);

  useEffect(() => {
    void apiClient.getDataQualityFilterOptions().then(setFilterOptions).catch(() => {
      setFilterOptions({
        entity_types: [],
        missing_field_types: [],
        duplicate_types: [],
        compliance_types: [],
      });
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const headers = useMemo(() => config.columns?.map((column) => column.key) ?? [], [config.columns]);

  return (
    <div className="space-y-6">
      <PageTitle title={config.title} description={config.description} />
      {filterOptions ? (
        <DataQualityFilterBar
          options={filterOptions}
          value={draftFilters}
          onChange={setDraftFilters}
          actions={{
            onApply: () => setAppliedFilters(cloneDataQualityFilters(draftFilters)),
            onClear: () => {
              const cleared = cloneDataQualityFilters(defaultDataQualityFilters);
              setDraftFilters(cleared);
              setAppliedFilters(cleared);
            },
            onExportCsv: () => exportRows(`${config.slug}.csv`, headers, rows, "csv"),
            onExportExcel: () => exportRows(`${config.slug}.xls`, headers, rows, "xls"),
            onPrint: () => printRows(config.title, headers, rows),
          }}
        />
      ) : null}
      {summary.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {summary.map((metric, index) => (
            <MetricCard
              key={metric.key}
              title={metric.label}
              value={String(metric.value ?? 0)}
              accent={metricAccent(index)}
            />
          ))}
        </div>
      ) : null}
      <AppTable title={config.title} description={config.description}>
        {error ? <p className="p-4 text-sm text-red-500">{error}</p> : null}
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading report...</p>
        ) : (
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
                    <TableCell key={column.key}>{String(row[column.key] ?? "-")}</TableCell>
                  ))}
                </TableRow>
              ))}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={config.columns?.length ?? 1} className="py-8 text-center text-sm text-muted-foreground">
                    No records found for the selected filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        )}
      </AppTable>
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
    </div>
  );
}
