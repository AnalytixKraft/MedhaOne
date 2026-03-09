"use client";

import { cn } from "@/lib/utils";
import { PurchaseOrderStatus } from "@/lib/api/client";

const statusStyles: Record<PurchaseOrderStatus, string> = {
  DRAFT: "border-amber-200 bg-amber-50 text-amber-700",
  APPROVED: "border-sky-200 bg-sky-50 text-sky-700",
  PARTIALLY_RECEIVED: "border-indigo-200 bg-indigo-50 text-indigo-700",
  CLOSED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  CANCELLED: "border-rose-200 bg-rose-50 text-rose-700",
};

export function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return (
    <span
      data-testid="status-badge"
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em]",
        statusStyles[status],
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
