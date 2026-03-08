"use client";

import { useEffect, useMemo, useState } from "react";

import { AuditLogDrawer } from "@/components/audit/audit-log-drawer";
import { usePermissions } from "@/components/auth/permission-provider";
import {
  AppActionBar,
  AppFormGrid,
  AppSectionCard,
  AppTable,
} from "@/components/erp/app-primitives";
import { PageTitle } from "@/components/layout/page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient, type AuditLogDetail, type AuditLogRecord } from "@/lib/api/client";

type SortKey = "timestamp" | "user_name" | "module" | "action" | "entity_type";

export default function AuditTrailPage() {
  const { user, hasPermission } = usePermissions();
  const canView = !!user && (user.is_superuser || hasPermission("audit:view"));

  const [filters, setFilters] = useState({
    userId: "",
    module: "",
    action: "",
    entityType: "",
    entityId: "",
    search: "",
    dateFrom: "",
    dateTo: "",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [rows, setRows] = useState<AuditLogRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<AuditLogDetail | null>(null);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiClient.listAuditLogs({
          page,
          page_size: pageSize,
          user_id: filters.userId || undefined,
          module: filters.module || undefined,
          action: filters.action || undefined,
          entity_type: filters.entityType || undefined,
          entity_id: filters.entityId || undefined,
          search: filters.search || undefined,
          date_from: filters.dateFrom ? `${filters.dateFrom}T00:00:00` : undefined,
          date_to: filters.dateTo ? `${filters.dateTo}T23:59:59` : undefined,
        });
        if (!cancelled) {
          setRows(response.data);
          setTotal(response.total);
        }
      } catch (caught) {
        if (!cancelled) {
          setRows([]);
          setTotal(0);
          setError(caught instanceof Error ? caught.message : "Failed to load audit logs.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [canView, filters.action, filters.dateFrom, filters.dateTo, filters.entityId, filters.entityType, filters.module, filters.search, filters.userId, page, pageSize]);

  const sortedRows = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((left, right) => {
      const leftValue = left[sortKey] ?? "";
      const rightValue = right[sortKey] ?? "";
      if (leftValue < rightValue) {
        return -1 * direction;
      }
      if (leftValue > rightValue) {
        return 1 * direction;
      }
      return 0;
    });
  }, [rows, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const toggleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "timestamp" ? "desc" : "asc");
  };

  const openAuditLog = async (id: string) => {
    try {
      const detail = await apiClient.getAuditLog(id);
      setSelectedLog(detail);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load audit detail.");
    }
  };

  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.userId) params.set("user_id", filters.userId);
    if (filters.module) params.set("module", filters.module);
    if (filters.action) params.set("action", filters.action);
    if (filters.entityType) params.set("entity_type", filters.entityType);
    if (filters.entityId) params.set("entity_id", filters.entityId);
    if (filters.search) params.set("search", filters.search);
    if (filters.dateFrom) params.set("date_from", `${filters.dateFrom}T00:00:00`);
    if (filters.dateTo) params.set("date_to", `${filters.dateTo}T23:59:59`);
    const query = params.toString();
    return query ? `/api/settings/audit-trail/export?${query}` : "/api/settings/audit-trail/export";
  }, [filters.action, filters.dateFrom, filters.dateTo, filters.entityId, filters.entityType, filters.module, filters.search, filters.userId]);

  if (!canView) {
    return (
      <div className="space-y-4">
        <PageTitle title="Audit Trail" description="Search audit events and record-level history." />
        <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground shadow-sm">
            You do not have permission to view audit logs.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle title="Audit Trail" description="Filter, review, and export record-level changes across modules." />

      <AppSectionCard title="Filters" description="Filter audit events by user, module, action, entity, and date range.">
          <AppFormGrid className="sticky top-0 z-10 pb-2 md:grid-cols-4">
            <Input
              value={filters.userId}
              onChange={(event) => {
                setPage(1);
                setFilters((current) => ({ ...current, userId: event.target.value }));
              }}
              placeholder="User ID"
            />
            <Input
              value={filters.module}
              onChange={(event) => {
                setPage(1);
                setFilters((current) => ({ ...current, module: event.target.value }));
              }}
              placeholder="Module"
            />
            <Input
              value={filters.action}
              onChange={(event) => {
                setPage(1);
                setFilters((current) => ({ ...current, action: event.target.value }));
              }}
              placeholder="Action"
            />
            <Input
              value={filters.entityType}
              onChange={(event) => {
                setPage(1);
                setFilters((current) => ({ ...current, entityType: event.target.value }));
              }}
              placeholder="Entity Type"
            />
            <Input
              value={filters.entityId}
              onChange={(event) => {
                setPage(1);
                setFilters((current) => ({ ...current, entityId: event.target.value }));
              }}
              placeholder="Entity ID"
            />
            <Input
              value={filters.search}
              onChange={(event) => {
                setPage(1);
                setFilters((current) => ({ ...current, search: event.target.value }));
              }}
              placeholder="Search text"
            />
            <Input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => {
                setPage(1);
                setFilters((current) => ({ ...current, dateFrom: event.target.value }));
              }}
            />
            <Input
              type="date"
              value={filters.dateTo}
              onChange={(event) => {
                setPage(1);
                setFilters((current) => ({ ...current, dateTo: event.target.value }));
              }}
            />
          </AppFormGrid>

          <AppActionBar className="justify-between">
            <p className="text-sm text-muted-foreground">{total} audit records found.</p>
            <a href={exportHref}>
              <Button type="button" variant="outline">Export CSV</Button>
            </a>
          </AppActionBar>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}

          <div className="flex items-center justify-between gap-2">
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
      </AppSectionCard>

      <AppTable title="Audit Events" description="Open the detail drawer to inspect before and after snapshots.">
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading audit logs...</p>
        ) : (
          <Table className="min-w-[1180px]">
            <TableHeader className="bg-[hsl(var(--table-header-bg))]">
              <TableRow>
                <TableHead>
                  <button type="button" onClick={() => toggleSort("timestamp")}>Timestamp</button>
                </TableHead>
                <TableHead>
                  <button type="button" onClick={() => toggleSort("user_name")}>User</button>
                </TableHead>
                <TableHead>
                  <button type="button" onClick={() => toggleSort("module")}>Module</button>
                </TableHead>
                <TableHead>
                  <button type="button" onClick={() => toggleSort("action")}>Action</button>
                </TableHead>
                <TableHead>
                  <button type="button" onClick={() => toggleSort("entity_type")}>Entity</button>
                </TableHead>
                <TableHead>Entity ID</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead className="text-right">View Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{new Date(row.timestamp).toLocaleString()}</TableCell>
                  <TableCell>{row.user_name || row.user_id}</TableCell>
                  <TableCell>{row.module}</TableCell>
                  <TableCell>{row.action}</TableCell>
                  <TableCell>{row.entity_type}</TableCell>
                  <TableCell>{row.entity_id}</TableCell>
                  <TableCell>
                    {row.summary || "-"}
                    {row.source_reference ? (
                      <div className="text-xs text-muted-foreground">{row.source_reference}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button type="button" variant="outline" size="sm" onClick={() => void openAuditLog(row.id)}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    No audit records match the current filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        )}
      </AppTable>

      <AuditLogDrawer open={selectedLog !== null} onClose={() => setSelectedLog(null)} log={selectedLog} />
    </div>
  );
}
