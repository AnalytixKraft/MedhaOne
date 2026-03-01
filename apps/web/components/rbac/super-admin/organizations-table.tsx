"use client";

import { Menu, MenuButton, MenuItem, MenuItems, Transition } from "@headlessui/react";
import { ChevronLeft, ChevronRight, EllipsisVertical, Search } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { StatusBadge } from "@/components/rbac/super-admin/status-badge";
import type { OrganizationDashboardRecord } from "@/lib/rbac/super-admin";

const pageSize = 5;

export function OrganizationsTable({
  organizations,
  nestedSudo = false,
  onViewDetails,
  onEditMaxUsers,
  onSudo,
  onViewAuditLogs,
  onDelete,
}: {
  organizations: OrganizationDashboardRecord[];
  nestedSudo?: boolean;
  onViewDetails: (organization: OrganizationDashboardRecord) => void;
  onEditMaxUsers: (organization: OrganizationDashboardRecord) => Promise<void>;
  onSudo: (organization: OrganizationDashboardRecord) => void;
  onViewAuditLogs: (organization: OrganizationDashboardRecord) => void;
  onDelete: (organization: OrganizationDashboardRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"All" | "Active" | "Near Limit" | "Limit Reached">("All");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const nextRows = organizations.filter((organization) => {
      const matchesQuery =
        organization.name.toLowerCase().includes(query.toLowerCase()) ||
        organization.schemaName.toLowerCase().includes(query.toLowerCase());
      const matchesFilter = filter === "All" ? true : organization.statusLabel === filter;
      return matchesQuery && matchesFilter;
    });

    return nextRows;
  }, [filter, organizations, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200/80 px-6 py-5 dark:border-slate-800">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">Organizations</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Capacity, audit visibility, and impersonation controls.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative block min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => {
                  setPage(1);
                  setQuery(event.target.value);
                }}
                placeholder="Search organizations"
                className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
            <select
              value={filter}
              onChange={(event) => {
                setPage(1);
                setFilter(event.target.value as typeof filter);
              }}
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            >
              <option>All</option>
              <option>Active</option>
              <option>Near Limit</option>
              <option>Limit Reached</option>
            </select>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-slate-200/80 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <th className="px-6 py-4">Organization</th>
              <th className="px-6 py-4">Schema</th>
              <th className="px-6 py-4">Max Users</th>
              <th className="px-6 py-4">Current Users</th>
              <th className="px-6 py-4">Usage</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((organization) => (
              <tr key={organization.id} className="border-b border-slate-100 transition hover:bg-slate-50/80 dark:border-slate-900 dark:hover:bg-slate-950/60">
                <td className="px-6 py-4 align-top">
                  <p className="text-sm font-medium text-slate-950 dark:text-slate-50">{organization.name}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{organization.id}</p>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">{organization.schemaName}</td>
                <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-100">{organization.maxUsers}</td>
                <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
                  <div>{organization.currentUsers}</div>
                  <div className="mt-1 text-xs text-slate-400">{organization.activeUsers} active</div>
                </td>
                <td className="px-6 py-4">
                  <div className="space-y-2">
                    <p className="text-sm text-slate-600 dark:text-slate-300">{organization.currentUsers} / {organization.maxUsers}</p>
                    <UsageSegments ratio={organization.usageRatio} />
                  </div>
                </td>
                <td className="px-6 py-4"><StatusBadge status={organization.statusLabel} /></td>
                <td className="px-6 py-4 text-right">
                  <ActionsMenu
                    nestedSudo={nestedSudo}
                    onViewDetails={() => onViewDetails(organization)}
                    onEditMaxUsers={() => onEditMaxUsers(organization)}
                    onSudo={() => onSudo(organization)}
                    onViewAuditLogs={() => onViewAuditLogs(organization)}
                    onDelete={() => onDelete(organization)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageRows.length === 0 ? (
        <div className="px-6 py-10 text-sm text-slate-500 dark:text-slate-400">No organizations match the current filters.</div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-slate-200/80 px-6 py-4 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <p>
          Showing {pageRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, filtered.length)} of {filtered.length}
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
    </div>
  );
}

function UsageSegments({ ratio }: { ratio: number }) {
  const filled = Math.min(10, Math.max(0, Math.round(ratio * 10)));
  const tone = ratio >= 1 ? "bg-rose-500" : ratio >= 0.8 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="flex gap-1">
      {Array.from({ length: 10 }).map((_, index) => (
        <span
          key={index}
          className={`h-1.5 w-4 rounded-full ${index < filled ? tone : "bg-slate-100 dark:bg-slate-800"}`}
        />
      ))}
    </div>
  );
}

function ActionsMenu({
  nestedSudo,
  onViewDetails,
  onEditMaxUsers,
  onSudo,
  onViewAuditLogs,
  onDelete,
}: {
  nestedSudo: boolean;
  onViewDetails: () => void;
  onEditMaxUsers: () => void | Promise<void>;
  onSudo: () => void;
  onViewAuditLogs: () => void;
  onDelete: () => void;
}) {
  return (
    <Menu as="div" className="relative inline-block text-left">
      <MenuButton className="rounded-2xl border border-transparent p-2 text-slate-500 transition duration-200 hover:scale-[1.03] hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900 dark:hover:border-slate-800 dark:hover:bg-slate-900 dark:hover:text-white">
        <EllipsisVertical className="h-4 w-4" />
      </MenuButton>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <MenuItems anchor="bottom end" className="z-20 mt-2 w-44 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl outline-none dark:border-slate-800 dark:bg-slate-950">
          <ActionItem label="View" onClick={onViewDetails} />
          <ActionItem label="Edit" onClick={onEditMaxUsers} />
          <ActionItem label="Sudo" disabled={nestedSudo} onClick={onSudo} />
          <ActionItem label="View Logs" onClick={onViewAuditLogs} />
          <ActionItem label="Delete" destructive onClick={onDelete} />
        </MenuItems>
      </Transition>
    </Menu>
  );
}

function ActionItem({
  label,
  disabled = false,
  destructive = false,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  onClick: () => void | Promise<void>;
}) {
  return (
    <MenuItem disabled={disabled}>
      {({ focus, disabled: itemDisabled }) => (
        <button
          className={[
            "flex w-full items-center rounded-xl px-3 py-2 text-sm transition",
            destructive ? "text-rose-600" : "text-slate-700 dark:text-slate-300",
            focus && !itemDisabled ? "bg-slate-100 dark:bg-slate-900" : "",
            itemDisabled ? "cursor-not-allowed opacity-40" : "",
          ].join(" ")}
          onClick={() => {
            if (!itemDisabled) {
              void onClick();
            }
          }}
        >
          {itemDisabled && label === "Sudo" ? "Sudo (blocked)" : label}
        </button>
      )}
    </MenuItem>
  );
}
