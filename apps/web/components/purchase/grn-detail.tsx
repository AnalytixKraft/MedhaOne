"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { RecordHistoryDrawer } from "@/components/audit/record-history-drawer";
import { usePermissions } from "@/components/auth/permission-provider";
import { AppActionBar, AppPageHeader, AppSectionCard, MetricCard } from "@/components/erp/app-primitives";
import { Button } from "@/components/ui/button";
import { ErpCombobox } from "@/components/ui/erp-combobox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Grn, PurchaseBill, apiClient } from "@/lib/api/client";

type GrnDetailProps = {
  grnId: number;
};

export function GrnDetail({ grnId }: GrnDetailProps) {
  const { hasPermission } = usePermissions();
  const [grn, setGrn] = useState<Grn | null>(null);
  const [purchaseBills, setPurchaseBills] = useState<PurchaseBill[]>([]);
  const [selectedBillId, setSelectedBillId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [grnData, billResponse] = await Promise.all([
        apiClient.getGrn(grnId),
        apiClient.listPurchaseBills(),
      ]);
      setGrn(grnData);
      setPurchaseBills(
        billResponse.items.filter(
          (bill) =>
            bill.status !== "CANCELLED" &&
            bill.supplier_id === grnData.supplier_id &&
            (bill.purchase_order_id === null || bill.purchase_order_id === grnData.purchase_order_id),
        ),
      );
      setSelectedBillId(grnData.purchase_bill_id ? String(grnData.purchase_bill_id) : "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load GRN");
    } finally {
      setLoading(false);
    }
  }, [grnId]);

  useEffect(() => {
    void load();
  }, [load]);

  const billOptions = useMemo(
    () => [{ label: "Select purchase bill", value: "" }].concat(
      purchaseBills.map((bill) => ({
        label: `${bill.bill_number} · ${bill.supplier_name_raw ?? bill.supplier_gstin ?? "Bill"}`,
        value: String(bill.id),
      })),
    ),
    [purchaseBills],
  );

  const handlePost = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.postGrn(grnId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post GRN");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.cancelGrn(grnId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel GRN");
    } finally {
      setSaving(false);
    }
  };

  const handleAttachBill = async () => {
    if (!selectedBillId) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiClient.attachBillToGrn(grnId, Number(selectedBillId));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to attach purchase bill");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading GRN...</p>;
  }

  if (!grn) {
    return <p className="text-sm text-red-500">GRN not found.</p>;
  }

  return (
    <div className="space-y-6">
      <AppPageHeader
        title={grn.grn_number}
        description="Warehouse receipt document with purchase order and optional purchase bill linkage."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/purchase/grn">Back to List</Link>
            </Button>
            {grn.status === "DRAFT" && hasPermission("grn:edit") ? (
              <Button asChild variant="outline">
                <Link href={`/purchase/grn/${grn.id}/edit`}>Edit Draft</Link>
              </Button>
            ) : null}
            {grn.status === "DRAFT" && hasPermission("grn:post") ? (
              <Button onClick={() => void handlePost()} disabled={saving} data-testid="post-grn">
                Post GRN
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex justify-end">
        <span
          data-testid="status-badge"
          className="rounded-full border border-border bg-[hsl(var(--muted-bg))] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-primary))]"
        >
          {grn.status}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="Status" value={grn.status} />
        <MetricCard title="Total Products" value={grn.total_products} />
        <MetricCard title="Total Received Qty" value={grn.total_received_qty} />
      </div>

      <AppSectionCard title="Header Details" description="Primary receiving document context.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">PO Number</p>
            <p className="text-sm font-medium">{grn.po_number ?? "-"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Purchase Bill</p>
            <p className="text-sm font-medium">{grn.purchase_bill_number ?? "-"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Supplier</p>
            <p className="text-sm font-medium">{grn.supplier_name ?? "-"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Warehouse</p>
            <p className="text-sm font-medium">{grn.warehouse_name ?? "-"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Received Date</p>
            <p className="text-sm font-medium">{grn.received_date}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Created By</p>
            <p className="text-sm font-medium">{grn.created_by_name ?? "-"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Posted By</p>
            <p className="text-sm font-medium">{grn.posted_by_name ?? "-"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Remarks</p>
            <p className="text-sm font-medium">{grn.remarks ?? "-"}</p>
          </div>
        </div>
      </AppSectionCard>

      <AppSectionCard title="Received Lines" description="Product-level receipt summary with batch breakdown underneath each line.">
        <div className="space-y-4">
          {grn.lines.map((line) => (
            <div key={line.id} className="rounded-2xl border border-border">
              <div className="grid gap-4 border-b border-border/70 bg-[hsl(var(--muted-bg))] p-4 md:grid-cols-5">
                <div className="md:col-span-2">
                  <p className="text-sm font-semibold">{line.product_name ?? line.product_name_snapshot ?? `Product ${line.product_id}`}</p>
                  <p className="text-xs text-muted-foreground">
                    Ordered {line.ordered_qty_snapshot ?? "-"} · This GRN {line.received_qty_total} · Free {line.free_qty_total}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Bill Qty</p>
                  <p className="text-sm font-medium">{line.billed_qty_snapshot ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">HSN</p>
                  <p className="text-sm font-medium">{line.hsn_code ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Remarks</p>
                  <p className="text-sm font-medium">{line.remarks ?? "-"}</p>
                </div>
              </div>
              <div className="p-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch No</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead>MFG</TableHead>
                      <TableHead>Received Qty</TableHead>
                      <TableHead>Free Qty</TableHead>
                      <TableHead>MRP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {line.batch_lines.map((batch) => (
                      <TableRow key={batch.id}>
                        <TableCell>{batch.batch_no}</TableCell>
                        <TableCell>{batch.expiry_date}</TableCell>
                        <TableCell>{batch.mfg_date ?? "-"}</TableCell>
                        <TableCell>{batch.received_qty}</TableCell>
                        <TableCell>{batch.free_qty}</TableCell>
                        <TableCell>{batch.mrp ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </div>
      </AppSectionCard>

      <AppSectionCard
        title="Purchase Bill Linkage"
        description="Attach a bill later if goods were received before the invoice arrived."
      >
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <ErpCombobox
            options={billOptions}
            value={selectedBillId}
            onValueChange={setSelectedBillId}
            placeholder="Select purchase bill"
            searchPlaceholder="Search bill number"
            emptyMessage="No bills available"
          />
          {hasPermission("grn:attach_bill") ? (
            <Button variant="outline" onClick={() => void handleAttachBill()} disabled={saving || !selectedBillId}>
              Attach Bill
            </Button>
          ) : null}
        </div>
      </AppSectionCard>

      <AppActionBar>
        <p className="mr-auto text-sm text-muted-foreground">
          Posted GRNs remain immutable and drive stock inward at batch level only.
        </p>
        {grn.status === "DRAFT" && hasPermission("grn:cancel") ? (
          <Button variant="outline" onClick={() => void handleCancel()} disabled={saving}>
            Cancel Draft
          </Button>
        ) : null}
        <Button variant="outline" onClick={() => setHistoryOpen(true)}>
          History
        </Button>
      </AppActionBar>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      <RecordHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        entityType="GRN"
        entityId={grn.id}
        title="GRN Activity"
      />
    </div>
  );
}
