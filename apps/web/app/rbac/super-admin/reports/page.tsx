"use client";

import { useMemo } from "react";

import { SuperAdminLayout } from "@/components/rbac/super-admin/layout";
import { ReportsCharts } from "@/components/rbac/super-admin/reports-charts";
import { useSuperAdminOrganizations } from "@/components/rbac/super-admin/use-super-admin-organizations";
import {
  buildGrowthSeries,
  buildOrganizationDashboardRecords,
  buildRoleDistribution,
} from "@/lib/rbac/super-admin";

export default function SuperAdminReportsPage() {
  const { organizations, error } = useSuperAdminOrganizations();
  const dashboardRecords = useMemo(() => buildOrganizationDashboardRecords(organizations), [organizations]);
  const growthSeries = useMemo(() => buildGrowthSeries(dashboardRecords), [dashboardRecords]);
  const roleDistribution = useMemo(() => buildRoleDistribution(dashboardRecords), [dashboardRecords]);
  const activityRows = useMemo(
    () =>
      dashboardRecords
        .map((record) => ({ name: record.name, value: Math.min(100, Math.round(record.usageRatio * 100) + record.currentUsers * 8) }))
        .sort((left, right) => right.value - left.value)
        .slice(0, 5),
    [dashboardRecords],
  );

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600 dark:text-sky-400">Reports</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Platform growth and activity</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
            Monitor organization growth, user expansion, role distribution, and sudo activity from a consolidated reporting workspace.
          </p>
        </div>

        {error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <ReportsCharts
          growthSeries={growthSeries}
          roleDistribution={roleDistribution}
          activityRows={activityRows}
        />
      </div>
    </SuperAdminLayout>
  );
}
