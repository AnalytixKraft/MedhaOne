"use client";

import type { LucideIcon } from "lucide-react";
import { TrendingUp } from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";

export function MetricCard({
  icon: Icon,
  label,
  value,
  subtext,
  trend,
  sparkline,
  loading = false,
}: {
  icon: LucideIcon;
  label: string;
  value?: number;
  subtext?: string;
  trend?: string;
  sparkline?: number[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div className="h-10 w-10 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
          <div className="h-3 w-20 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
        </div>
        <div className="mt-7 h-3 w-28 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
        <div className="mt-3 h-9 w-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
        <div className="mt-4 h-10 w-full animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
      </div>
    );
  }

  const chartData = (sparkline ?? []).map((point, index) => ({
    index,
    point,
  }));

  return (
    <div className="group rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-lg hover:shadow-slate-200/70 dark:border-slate-800 dark:bg-slate-900 dark:hover:shadow-black/10">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-2xl border border-slate-200/80 p-2.5 text-slate-700 dark:border-slate-800 dark:text-slate-200">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex items-center gap-1 rounded-full border border-emerald-200/80 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:border-emerald-500/20 dark:text-emerald-300">
          <TrendingUp className="h-3 w-3" />
          <span>{trend}</span>
        </div>
      </div>
      <p className="mt-6 text-xs font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-4">
        <div>
          <p className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">{value}</p>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{subtext}</p>
        </div>
      </div>
      <div className="mt-5 h-12 rounded-2xl border border-slate-100 px-2 py-1 dark:border-slate-800/80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <Line
              type="monotone"
              dataKey="point"
              stroke="#0f172a"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
