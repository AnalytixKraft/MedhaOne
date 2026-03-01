"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCard } from "@/components/rbac/super-admin/chart-card";

export function ReportsCharts({
  growthSeries,
  roleDistribution,
  activityRows,
}: {
  growthSeries: Array<{ label: string; organizations: number; users: number; sudo: number }>;
  roleDistribution: Array<{ name: string; value: number }>;
  activityRows: Array<{ name: string; value: number }>;
}) {
  const pieColors = ["#0f172a", "#475569", "#94a3b8"];

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <ChartCard title="Organization Growth" subtitle="Tenant creation trend over time">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={growthSeries}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip />
            <Line type="monotone" dataKey="organizations" stroke="#0f172a" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="User Growth" subtitle="Cross-tenant user expansion">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={growthSeries}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip />
            <Line type="monotone" dataKey="users" stroke="#334155" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Role Distribution" subtitle="Current role mix">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={roleDistribution} dataKey="value" nameKey="name" innerRadius={66} outerRadius={96} paddingAngle={3}>
              {roleDistribution.map((entry, index) => (
                <Cell key={entry.name} fill={pieColors[index % pieColors.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
        <div className="mt-4 flex flex-wrap gap-3">
          {roleDistribution.map((item, index) => (
            <div key={item.name} className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <span className={`h-2.5 w-2.5 rounded-full ${index === 0 ? "bg-slate-950 dark:bg-slate-100" : index === 1 ? "bg-slate-600" : "bg-slate-400"}`} />
              <span>{item.name}</span>
            </div>
          ))}
        </div>
      </ChartCard>

      <ChartCard title="Sudo Activity" subtitle="Impersonation events over time">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={growthSeries}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip />
            <Bar dataKey="sudo" fill="#f59e0b" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="xl:col-span-2">
        <ChartCard title="Most Active Organizations" subtitle="Weighted activity by org">
          <div className="space-y-4">
            {activityRows.map((row) => (
              <div key={row.name} className="space-y-2">
                <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
                  <span>{row.name}</span>
                  <span>{row.value}%</span>
                </div>
                <div className="flex gap-1">
                  {Array.from({ length: 10 }).map((_, index) => (
                    <span
                      key={`${row.name}-${index}`}
                      className={`h-1.5 w-full rounded-full ${index < Math.max(1, Math.round(row.value / 10)) ? "bg-slate-900 dark:bg-slate-100" : "bg-slate-100 dark:bg-slate-800"}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
