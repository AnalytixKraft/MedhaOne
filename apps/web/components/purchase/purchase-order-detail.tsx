"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AppPageHeader, AppSectionCard, AppTable } from "@/components/erp/app-primitives";
import { PurchaseOrderStatusBadge } from "@/components/purchase/purchase-order-status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiClient, PurchaseOrder, RecordHistoryResponse } from "@/lib/api/client";

const amountFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function PurchaseOrderDetail({ purchaseOrderId }: { purchaseOrderId: number }) {
  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [history, setHistory] = useState<RecordHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<"approve" | "cancel" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [po, recordHistory] = await Promise.all([
        apiClient.getPurchaseOrder(purchaseOrderId),
        apiClient.getRecordHistory("PO", purchaseOrderId).catch(() => null),
      ]);
      setPurchaseOrder(po);
      setHistory(recordHistory);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load purchase order.");
    } finally {
      setLoading(false);
    }
  }, [purchaseOrderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleApprove() {
    setWorking("approve");
    setError(null);
    try {
      await apiClient.approvePurchaseOrder(purchaseOrderId);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to approve purchase order.");
    } finally {
      setWorking(null);
    }
  }

  async function handleCancel() {
    setWorking("cancel");
    setError(null);
    try {
      await apiClient.cancelPurchaseOrder(purchaseOrderId);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to cancel purchase order.");
    } finally {
      setWorking(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading purchase order...</p>;
  }

  if (!purchaseOrder) {
    return <p className="text-sm text-rose-600">Purchase order not found.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader
        title={purchaseOrder.po_number}
        description="Review the purchase order, line items, totals, and document activity."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/purchase-orders">Back to List</Link>
            </Button>
            {purchaseOrder.status === "DRAFT" ? (
              <Button asChild variant="outline">
                <Link href={`/purchase-orders/${purchaseOrder.id}/edit`}>Edit Draft</Link>
              </Button>
            ) : null}
            {purchaseOrder.status === "DRAFT" ? (
              <Button onClick={() => void handleApprove()} disabled={working !== null}>
                {working === "approve" ? "Approving..." : "Approve PO"}
              </Button>
            ) : null}
            {purchaseOrder.status === "DRAFT" ? (
              <Button variant="outline" onClick={() => void handleCancel()} disabled={working !== null}>
                {working === "cancel" ? "Cancelling..." : "Cancel PO"}
              </Button>
            ) : null}
            <Button asChild variant="outline" disabled={purchaseOrder.status !== "APPROVED"}>
              <Link href={`/purchase/grn/new?poId=${purchaseOrder.id}`}>Create GRN</Link>
            </Button>
          </>
        }
      />

      {error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      ) : null}

      <AppSectionCard title="Header Details" description="Supplier, warehouse, document dates, and status context.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">Status</p>
            <div className="mt-2">
              <PurchaseOrderStatusBadge status={purchaseOrder.status} />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">Supplier</p>
            <p className="mt-2 text-sm font-medium">{purchaseOrder.supplier_name ?? `Supplier #${purchaseOrder.supplier_id}`}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">Warehouse</p>
            <p className="mt-2 text-sm font-medium">{purchaseOrder.warehouse_name ?? `Warehouse #${purchaseOrder.warehouse_id}`}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">PO Date</p>
            <p className="mt-2 text-sm font-medium">{purchaseOrder.order_date}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">Created By</p>
            <p className="mt-2 text-sm font-medium">{purchaseOrder.created_by_name ?? `User #${purchaseOrder.created_by}`}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">Created At</p>
            <p className="mt-2 text-sm font-medium">{new Date(purchaseOrder.created_at).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">Updated At</p>
            <p className="mt-2 text-sm font-medium">{new Date(purchaseOrder.updated_at).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">Tax Mode</p>
            <p className="mt-2 text-sm font-medium">{purchaseOrder.tax_type ?? "UNDETERMINED"}</p>
          </div>
        </div>
      </AppSectionCard>

      <AppTable title="Line Items" description="Read-only purchase order line details.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit Cost</TableHead>
              <TableHead className="text-right">GST %</TableHead>
              <TableHead className="text-right">Tax Amount</TableHead>
              <TableHead>HSN Code</TableHead>
              <TableHead className="text-right">Line Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {purchaseOrder.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>{line.product_name ?? line.product_sku ?? `Product #${line.product_id}`}</TableCell>
                <TableCell>—</TableCell>
                <TableCell>—</TableCell>
                <TableCell className="text-right tabular-nums">{line.ordered_qty}</TableCell>
                <TableCell className="text-right tabular-nums">{amountFormatter.format(Number.parseFloat(line.unit_cost ?? "0"))}</TableCell>
                <TableCell className="text-right tabular-nums">{Number.parseFloat(line.gst_percent).toFixed(2)}%</TableCell>
                <TableCell className="text-right tabular-nums">{amountFormatter.format(Number.parseFloat(line.tax_amount))}</TableCell>
                <TableCell>{line.hsn_code || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{amountFormatter.format(Number.parseFloat(line.line_total))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AppTable>

      <AppSectionCard title="Summary" description="Rolled-up purchase order financial totals.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryBlock label="Subtotal" value={purchaseOrder.subtotal} />
          <SummaryBlock label="Discount" value={purchaseOrder.discount_amount} />
          <SummaryBlock label="Taxable Value" value={purchaseOrder.taxable_value} />
          <SummaryBlock label="CGST" value={purchaseOrder.cgst_amount} />
          <SummaryBlock label="SGST" value={purchaseOrder.sgst_amount} />
          <SummaryBlock label="IGST" value={purchaseOrder.igst_amount} />
          <SummaryBlock label="Adjustment" value={purchaseOrder.adjustment} />
          <SummaryBlock label="Final Total" value={purchaseOrder.final_total} strong />
        </div>
      </AppSectionCard>

      <AppSectionCard title="Activity" description="Document audit history for this purchase order.">
        {history?.entries.length ? (
          <div className="space-y-3">
            {history.entries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-border p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
                  <span>{entry.action}</span>
                  <span>{new Date(entry.timestamp).toLocaleString()}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-[hsl(var(--text-primary))]">
                  {entry.summary || `${entry.action} ${entry.entity_type}`}
                </p>
                <p className="mt-1 text-sm text-[hsl(var(--text-secondary))]">
                  {entry.user_name || "Unknown user"}
                  {entry.remarks ? ` • ${entry.remarks}` : ""}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No activity recorded for this purchase order.</p>
        )}
      </AppSectionCard>
    </div>
  );
}

function SummaryBlock({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-[hsl(var(--muted-bg))] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">{label}</p>
      <p className={`mt-2 text-lg tabular-nums ${strong ? "font-semibold" : "font-medium"}`}>
        {amountFormatter.format(Number.parseFloat(value))}
      </p>
    </div>
  );
}
