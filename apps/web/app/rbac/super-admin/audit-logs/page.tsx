"use client";

import { useMemo } from "react";

import { AuditLogTable } from "@/components/rbac/super-admin/audit-log-table";
import { SuperAdminLayout } from "@/components/rbac/super-admin/layout";
import { useSuperAdminOrganizations } from "@/components/rbac/super-admin/use-super-admin-organizations";
import { buildAuditLogs, buildOrganizationDashboardRecords } from "@/lib/rbac/super-admin";

export default function SuperAdminAuditLogsPage() {
  const { organizations, error } = useSuperAdminOrganizations();
  const dashboardRecords = useMemo(() => buildOrganizationDashboardRecords(organizations), [organizations]);
  const logs = useMemo(() => buildAuditLogs(dashboardRecords), [dashboardRecords]);

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600 dark:text-sky-400">Audit logs</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Security and control-plane activity</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
            Review who acted, which tenant was affected, and how privilege-sensitive operations are trending.
          </p>
        </div>

        {error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <AuditLogTable logs={logs} />
      </div>
    </SuperAdminLayout>
  );
}
