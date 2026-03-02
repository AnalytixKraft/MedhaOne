"use client";

import { useMemo } from "react";
import { Building2, KeyRound, LifeBuoy, ShieldCheck, ShieldUser, Users } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCard } from "@/components/rbac/super-admin/chart-card";
import { MetricCard } from "@/components/rbac/super-admin/metric-card";
import { useSuperAdminOrganizations } from "@/components/rbac/super-admin/use-super-admin-organizations";
import {
  buildGrowthSeries,
  buildOrganizationDashboardRecords,
  buildSummaryMetrics,
} from "@/lib/rbac/super-admin";

const metricIcons = [Building2, Users, ShieldCheck, ShieldUser, LifeBuoy, KeyRound];

export function SuperAdminDashboardView() {
  const { organizations, loading, error } = useSuperAdminOrganizations();
  const dashboardRecords = useMemo(() => buildOrganizationDashboardRecords(organizations), [organizations]);
  const summaryMetrics = useMemo(() => buildSummaryMetrics(dashboardRecords), [dashboardRecords]);
  const growthSeries = useMemo(() => buildGrowthSeries(dashboardRecords), [dashboardRecords]);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600 dark:text-sky-400">
          Dashboard
        </p>
        <div className="space-y-2">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
            Super Admin Control Panel
          </h2>
          <p className="max-w-3xl text-sm text-slate-500 dark:text-slate-400">
            Platform-wide tenant volume, user load, and trend signals for the control plane.
          </p>
        </div>
      </section>

      {error ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {metricIcons.map((Icon, index) => {
          const metric = summaryMetrics[index] ?? {
            label: `metric-${index}`,
            value: 0,
            subtext: "",
            trend: "",
            sparkline: [],
          };
          return (
          <MetricCard
            key={loading ? index : metric?.label ?? index}
            icon={Icon}
            label={loading ? "Loading" : metric.label}
            value={loading ? undefined : metric.value}
            subtext={loading ? undefined : metric.subtext}
            trend={loading ? undefined : metric.trend}
            sparkline={loading ? undefined : metric.sparkline}
            loading={loading}
          />
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Organization Growth" subtitle="Tenant creation trend over time">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={growthSeries}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip />
              <Line type="monotone" dataKey="organizations" stroke="#0f172a" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="User Growth" subtitle="Cross-tenant user growth">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={growthSeries}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip />
              <Line type="monotone" dataKey="users" stroke="#334155" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>
    </div>
  );
}
