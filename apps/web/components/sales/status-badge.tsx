"use client";

import { cn } from "@/lib/utils";

import type { DispatchNoteStatus, SalesOrderStatus, StockReservationStatus } from "@/lib/api/client";

const statusToneMap: Record<string, string> = {
  DRAFT:
    "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  CONFIRMED:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300",
  PARTIALLY_DISPATCHED:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
  DISPATCHED:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  CANCELLED:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300",
  ACTIVE:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300",
  PARTIALLY_CONSUMED:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
  CONSUMED:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  RELEASED:
    "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  POSTED:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300",
};

function Badge({ label }: { label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-tight",
        statusToneMap[label] ??
          "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
      )}
    >
      {label.replaceAll("_", " ")}
    </span>
  );
}

export function SalesOrderStatusBadge({ status }: { status: SalesOrderStatus }) {
  return <Badge label={status} />;
}

export function DispatchStatusBadge({ status }: { status: DispatchNoteStatus }) {
  return <Badge label={status} />;
}

export function ReservationStatusBadge({ status }: { status: StockReservationStatus }) {
  return <Badge label={status} />;
}
