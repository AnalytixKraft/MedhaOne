"use client";

import { cn } from "@/lib/utils";

export function StatusBadge({
  status,
}: {
  status: "Active" | "Near Limit" | "Limit Reached";
}) {
  const tone =
    status === "Limit Reached"
      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
      : status === "Near Limit"
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
        : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-tight",
        tone,
      )}
    >
      {status}
    </span>
  );
}
