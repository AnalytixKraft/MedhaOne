"use client";

import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import type { AuditLogRecord } from "@/lib/rbac/super-admin";

const pageSize = 8;

export function AuditLogTable({ logs }: { logs: AuditLogRecord[] }) {
  const [filters, setFilters] = useState({
    action: "ALL",
    organization: "ALL",
    user: "",
    search: "",
    from: "",
    to: "",
  });
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);

  const organizations = useMemo(() => Array.from(new Set(logs.map((log) => log.targetOrg))), [logs]);
  const actionTypes = useMemo(() => Array.from(new Set(logs.map((log) => log.action))), [logs]);

  const filtered = useMemo(() => {
    return logs.filter((log) => {
      if (filters.action !== "ALL" && log.action !== filters.action) {
        return false;
      }
      if (filters.organization !== "ALL" && log.targetOrg !== filters.organization) {
        return false;
      }
      if (filters.user && !log.performedBy.toLowerCase().includes(filters.user.toLowerCase())) {
        return false;
      }
      if (filters.search) {
        const haystack = `${log.action} ${log.targetOrg} ${log.details}`.toLowerCase();
        if (!haystack.includes(filters.search.toLowerCase())) {
          return false;
        }
      }
      if (filters.from && new Date(log.timestamp) < new Date(filters.from)) {
        return false;
      }
      if (filters.to && new Date(log.timestamp) > endOfDay(filters.to)) {
        return false;
      }
      return true;
    });
  }, [filters, logs]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/95 px-6 py-5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">Audit Logs</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Search and review security-sensitive actions across the control plane.</p>
          </div>
          <label className="relative block min-w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={filters.search}
              onChange={(event) => {
                setPage(1);
                setFilters((current) => ({ ...current, search: event.target.value }));
              }}
              placeholder="Search logs"
              className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
        </div>
      </div>

      <Disclosure as="div" defaultOpen>
        {({ open }) => (
          <>
            <DisclosureButton className="flex w-full items-center justify-between border-b border-slate-200/80 px-6 py-4 text-left dark:border-slate-800">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Filters</span>
              <ChevronDown className={cn("h-4 w-4 text-slate-400 transition", open && "rotate-180")} />
            </DisclosureButton>
            <DisclosurePanel className="border-b border-slate-200/80 px-6 py-5 dark:border-slate-800">
              <div className="grid gap-3 lg:grid-cols-5">
                <SelectField
                  label="Action"
                  value={filters.action}
                  options={["ALL", ...actionTypes]}
                  onChange={(value) => {
                    setPage(1);
                    setFilters((current) => ({ ...current, action: value }));
                  }}
                />
                <SelectField
                  label="Organization"
                  value={filters.organization}
                  options={["ALL", ...organizations]}
                  onChange={(value) => {
                    setPage(1);
                    setFilters((current) => ({ ...current, organization: value }));
                  }}
                />
                <InputField
                  label="User"
                  value={filters.user}
                  placeholder="superadmin@..."
                  onChange={(value) => {
                    setPage(1);
                    setFilters((current) => ({ ...current, user: value }));
                  }}
                />
                <InputField
                  label="From"
                  value={filters.from}
                  type="date"
                  onChange={(value) => {
                    setPage(1);
                    setFilters((current) => ({ ...current, from: value }));
                  }}
                />
                <InputField
                  label="To"
                  value={filters.to}
                  type="date"
                  onChange={(value) => {
                    setPage(1);
                    setFilters((current) => ({ ...current, to: value }));
                  }}
                />
              </div>
            </DisclosurePanel>
          </>
        )}
      </Disclosure>

      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-slate-200/80 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <th className="px-6 py-4">Timestamp</th>
              <th className="px-6 py-4">Action</th>
              <th className="px-6 py-4">Performed By</th>
              <th className="px-6 py-4">Target Org</th>
              <th className="px-6 py-4">Role</th>
              <th className="px-6 py-4">IP Address</th>
              <th className="px-6 py-4 text-right">Details</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((log) => (
              <tr key={log.id} className="group border-b border-slate-100 transition hover:bg-slate-50/80 dark:border-slate-900 dark:hover:bg-slate-950/60">
                <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">{formatTimestamp(log.timestamp)}</td>
                <td className="px-6 py-4"><ActionBadge action={log.action} /></td>
                <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">{log.performedBy}</td>
                <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">{log.targetOrg}</td>
                <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">{log.role}</td>
                <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">{log.ipAddress}</td>
                <td className="px-6 py-4 text-right">
                  <button
                    className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-600 opacity-0 transition duration-150 group-hover:opacity-100 hover:scale-[1.01] hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:text-white"
                    onClick={() => setDetailId((current) => (current === log.id ? null : log.id))}
                  >
                    {detailId === log.id ? "Hide" : "JSON"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detailId ? (
        <div className="border-t border-slate-200/80 px-6 py-4 dark:border-slate-800">
          <pre className="overflow-x-auto rounded-2xl bg-slate-950 px-4 py-4 text-xs text-slate-100">
            {visibleRows.find((row) => row.id === detailId)?.details ?? "{}"}
          </pre>
        </div>
      ) : null}

      {visibleRows.length === 0 ? (
        <div className="px-6 py-10 text-sm text-slate-500 dark:text-slate-400">No audit entries match the current filters.</div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-slate-200/80 px-6 py-4 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <p>
          Showing {visibleRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, filtered.length)} of {filtered.length}
        </p>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1 rounded-2xl border border-slate-200 px-3 py-2 transition hover:scale-[1.01] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:hover:text-white"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={safePage <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
            <span>Prev</span>
          </button>
          <span className="px-2 text-xs font-medium uppercase tracking-[0.18em]">{safePage} / {totalPages}</span>
          <button
            className="inline-flex items-center gap-1 rounded-2xl border border-slate-200 px-3 py-2 transition hover:scale-[1.01] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:hover:text-white"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={safePage >= totalPages}
          >
            <span>Next</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "date";
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
      />
    </label>
  );
}

function ActionBadge({ action }: { action: string }) {
  const tone =
    action === "SUDO_SESSION_STARTED"
      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
      : action === "ORGANIZATION_MAX_USERS_UPDATED"
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
        : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";

  return <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium", tone)}>{action}</span>;
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function endOfDay(value: string) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}
