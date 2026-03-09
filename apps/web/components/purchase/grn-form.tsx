"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { RecordHistoryDrawer } from "@/components/audit/record-history-drawer";
import { usePermissions } from "@/components/auth/permission-provider";
import { AppActionBar, AppPageHeader, AppSectionCard } from "@/components/erp/app-primitives";
import { Button } from "@/components/ui/button";
import { ErpCombobox } from "@/components/ui/erp-combobox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CreateGrnFromBillPayload,
  CreateGrnFromPoPayload,
  Grn,
  GrnBatchLinePayload,
  GrnLinePayload,
  PurchaseBill,
  PurchaseOrder,
  UpdateGrnPayload,
  apiClient,
} from "@/lib/api/client";

type BatchDraft = {
  id?: number;
  batch_id?: number | null;
  batch_no: string;
  expiry_date: string;
  mfg_date: string;
  mrp: string;
  received_qty: string;
  free_qty: string;
  unit_cost: string;
  remarks: string;
};

type LineDraft = {
  grnLineId?: number;
  po_line_id: number | null;
  purchase_bill_line_id?: number | null;
  product_id: number;
  product_name: string;
  ordered_qty: string;
  billed_qty: string;
  already_received_qty: string;
  pending_qty: string;
  remarks: string;
  batch_rows: BatchDraft[];
};

type GrnFormProps = {
  mode: "create" | "edit";
  source: "po" | "bill";
  grnId?: number;
};

function createBlankBatch(unitCost = ""): BatchDraft {
  return {
    batch_id: null,
    batch_no: "",
    expiry_date: "",
    mfg_date: "",
    mrp: "",
    received_qty: "",
    free_qty: "0",
    unit_cost: unitCost,
    remarks: "",
  };
}

function sumBatchValues(rows: BatchDraft[], key: "received_qty" | "free_qty") {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

export function GrnForm({ mode, source, grnId }: GrnFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasPermission } = usePermissions();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseBills, setPurchaseBills] = useState<PurchaseBill[]>([]);
  const [existingGrn, setExistingGrn] = useState<Grn | null>(null);
  const [selectedPoId, setSelectedPoId] = useState(searchParams.get("poId") ?? "");
  const [selectedBillId, setSelectedBillId] = useState(searchParams.get("billId") ?? "");
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPo = useMemo(
    () => purchaseOrders.find((po) => String(po.id) === selectedPoId) ?? null,
    [purchaseOrders, selectedPoId],
  );
  const selectedBill = useMemo(
    () => purchaseBills.find((bill) => String(bill.id) === selectedBillId) ?? null,
    [purchaseBills, selectedBillId],
  );

  const poOptions = useMemo(
    () =>
      purchaseOrders
        .filter((po) => ["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status) || String(po.id) === selectedPoId)
        .map((po) => ({
          label: `${po.po_number} · ${po.supplier_name ?? "Supplier"}`,
          value: String(po.id),
        })),
    [purchaseOrders, selectedPoId],
  );

  const billOptions = useMemo(
    () =>
      purchaseBills
        .filter((bill) => bill.status !== "CANCELLED")
        .map((bill) => ({
          label: `${bill.bill_number} · ${bill.supplier_name_raw ?? bill.supplier_gstin ?? "Bill"}`,
          value: String(bill.id),
        })),
    [purchaseBills],
  );

  const initialiseFromPurchaseOrder = useCallback((purchaseOrder: PurchaseOrder) => {
    const nextLines = purchaseOrder.lines
      .map<LineDraft | null>((line) => {
        const remainingQty = Math.max(Number(line.ordered_qty) - Number(line.received_qty), 0);
        if (remainingQty <= 0) {
          return null;
        }
        return {
          po_line_id: line.id,
          purchase_bill_line_id: null,
          product_id: line.product_id,
          product_name: line.product_name ?? line.product_sku ?? `Product ${line.product_id}`,
          ordered_qty: String(line.ordered_qty),
          billed_qty: "0",
          already_received_qty: String(line.received_qty),
          pending_qty: String(remainingQty),
          remarks: "",
          batch_rows: [createBlankBatch(line.unit_cost ?? "")],
        };
      })
      .filter((line): line is LineDraft => line !== null);
    setLineDrafts(nextLines);
  }, []);

  const initialiseFromBill = useCallback((bill: PurchaseBill, purchaseOrder: PurchaseOrder | null) => {
    if (!purchaseOrder) {
      setLineDrafts([]);
      return;
    }
    const poByProduct = new Map<number, PurchaseOrder["lines"][number][]>();
    for (const poLine of purchaseOrder.lines) {
      const bucket = poByProduct.get(poLine.product_id) ?? [];
      bucket.push(poLine);
      poByProduct.set(poLine.product_id, bucket);
    }
    const nextLines: LineDraft[] = bill.lines.map((line) => {
      const poLine = line.product_id ? (poByProduct.get(line.product_id)?.[0] ?? null) : null;
      const remainingQty = poLine
        ? Math.max(Number(poLine.ordered_qty) - Number(poLine.received_qty), 0)
        : Number(line.qty || 0);
      return {
        po_line_id: poLine?.id ?? null,
        purchase_bill_line_id: line.id,
        product_id: line.product_id ?? poLine?.product_id ?? 0,
        product_name:
          line.description_raw ||
          poLine?.product_name ||
          poLine?.product_sku ||
          `Product ${line.product_id ?? ""}`,
        ordered_qty: poLine ? String(poLine.ordered_qty) : "0",
        billed_qty: String(line.qty),
        already_received_qty: poLine ? String(poLine.received_qty) : "0",
        pending_qty: String(remainingQty),
        remarks: "",
        batch_rows: [
          createBlankBatch(line.unit_price ?? ""),
        ].map((row) => ({
          ...row,
          batch_no: line.batch_no ?? "",
          expiry_date: line.expiry_date ?? "",
        })),
      };
    });
    setLineDrafts(nextLines);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [poData, billResponse] = await Promise.all([
        apiClient.listPurchaseOrders(),
        apiClient.listPurchaseBills(),
      ]);
      setPurchaseOrders(poData.items);
      setPurchaseBills(billResponse.items);

      if (mode === "edit" && grnId) {
        const grn = await apiClient.getGrn(grnId);
        setExistingGrn(grn);
        setSelectedPoId(String(grn.purchase_order_id));
        setSelectedBillId(grn.purchase_bill_id ? String(grn.purchase_bill_id) : "");
        setReceivedDate(grn.received_date);
        setRemarks(grn.remarks ?? "");
        setLineDrafts(
          grn.lines.map((line) => ({
            grnLineId: line.id,
            po_line_id: line.po_line_id,
            purchase_bill_line_id: line.purchase_bill_line_id,
            product_id: line.product_id,
            product_name:
              line.product_name ??
              line.product_name_snapshot ??
              line.product_sku ??
              `Product ${line.product_id}`,
            ordered_qty: line.ordered_qty_snapshot ?? "0",
            billed_qty: line.billed_qty_snapshot ?? "0",
            already_received_qty: "0",
            pending_qty: line.ordered_qty_snapshot ?? line.received_qty_total,
            remarks: line.remarks ?? "",
            batch_rows: line.batch_lines.map((batch) => ({
              id: batch.id,
              batch_id: batch.batch_id,
              batch_no: batch.batch_no,
              expiry_date: batch.expiry_date,
              mfg_date: batch.mfg_date ?? "",
              mrp: batch.mrp ?? "",
              received_qty: batch.received_qty,
              free_qty: batch.free_qty,
              unit_cost: batch.unit_cost ?? "",
              remarks: batch.remarks ?? "",
            })),
          })),
        );
        return;
      }

      if (source === "po" && selectedPoId) {
        const purchaseOrder = poData.items.find((po) => String(po.id) === selectedPoId);
        if (purchaseOrder) {
          initialiseFromPurchaseOrder(purchaseOrder);
        }
      }
      if (source === "bill" && selectedBillId) {
        const bill = billResponse.items.find((entry) => String(entry.id) === selectedBillId);
        const purchaseOrder = bill?.purchase_order_id
          ? poData.items.find((po) => po.id === bill.purchase_order_id) ?? null
          : null;
        if (bill && purchaseOrder) {
          setSelectedPoId(String(purchaseOrder.id));
          initialiseFromBill(bill, purchaseOrder);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load GRN workspace");
    } finally {
      setLoading(false);
    }
  }, [grnId, initialiseFromBill, initialiseFromPurchaseOrder, mode, selectedBillId, selectedPoId, source]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (mode !== "create") {
      return;
    }
    if (source === "po" && selectedPo) {
      initialiseFromPurchaseOrder(selectedPo);
    }
  }, [initialiseFromPurchaseOrder, mode, selectedPo, source]);

  useEffect(() => {
    if (mode !== "create" || source !== "bill" || !selectedBill) {
      return;
    }
    const billPo = selectedBill.purchase_order_id
      ? purchaseOrders.find((po) => po.id === selectedBill.purchase_order_id) ?? null
      : null;
    if (billPo) {
      setSelectedPoId(String(billPo.id));
    }
    initialiseFromBill(selectedBill, billPo);
  }, [initialiseFromBill, mode, purchaseOrders, selectedBill, source]);

  const updateLine = (index: number, patch: Partial<LineDraft>) => {
    setLineDrafts((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    );
  };

  const updateBatch = (lineIndex: number, batchIndex: number, patch: Partial<BatchDraft>) => {
    setLineDrafts((current) =>
      current.map((line, currentLineIndex) => {
        if (currentLineIndex !== lineIndex) {
          return line;
        }
        return {
          ...line,
          batch_rows: line.batch_rows.map((batch, currentBatchIndex) =>
            currentBatchIndex === batchIndex ? { ...batch, ...patch } : batch,
          ),
        };
      }),
    );
  };

  const addBatchRow = (lineIndex: number) => {
    setLineDrafts((current) =>
      current.map((line, currentLineIndex) =>
        currentLineIndex === lineIndex
          ? { ...line, batch_rows: [...line.batch_rows, createBlankBatch(line.batch_rows[0]?.unit_cost ?? "")] }
          : line,
      ),
    );
  };

  const removeBatchRow = (lineIndex: number, batchIndex: number) => {
    setLineDrafts((current) =>
      current.map((line, currentLineIndex) => {
        if (currentLineIndex !== lineIndex) {
          return line;
        }
        const nextRows = line.batch_rows.filter((_, index) => index !== batchIndex);
        return {
          ...line,
          batch_rows: nextRows.length ? nextRows : [createBlankBatch()],
        };
      }),
    );
  };

  const buildPayloadLines = (): GrnLinePayload[] =>
    lineDrafts
      .filter((line) => sumBatchValues(line.batch_rows, "received_qty") > 0)
      .map((line) => {
        const batchLines: GrnBatchLinePayload[] = line.batch_rows
          .filter((batch) => Number(batch.received_qty || 0) > 0)
          .map((batch) => ({
            batch_id: batch.batch_id ?? null,
            batch_no: batch.batch_no || undefined,
            expiry_date: batch.expiry_date || undefined,
            mfg_date: batch.mfg_date || undefined,
            mrp: batch.mrp || undefined,
            received_qty: batch.received_qty,
            free_qty: batch.free_qty,
            unit_cost: batch.unit_cost || undefined,
            remarks: batch.remarks || undefined,
          }));
        return {
          po_line_id: line.po_line_id,
          purchase_bill_line_id: line.purchase_bill_line_id ?? null,
          received_qty: String(sumBatchValues(line.batch_rows, "received_qty")),
          free_qty: String(sumBatchValues(line.batch_rows, "free_qty")),
          unit_cost: line.batch_rows[0]?.unit_cost || undefined,
          remarks: line.remarks || undefined,
          batch_lines: batchLines,
        };
      });

  const validateDraft = () => {
    if (!selectedPoId) {
      throw new Error("Purchase order is required");
    }
    const lines = buildPayloadLines();
    if (!lines.length) {
      throw new Error("Enter at least one received line");
    }
    for (const [lineIndex, line] of lineDrafts.entries()) {
      const receivedTotal = sumBatchValues(line.batch_rows, "received_qty");
      if (receivedTotal === 0) {
        continue;
      }
      for (const batch of line.batch_rows) {
        if (Number(batch.received_qty || 0) <= 0) {
          continue;
        }
        if (!batch.batch_no) {
          throw new Error(`Batch number is required for line ${lineIndex + 1}`);
        }
        if (!batch.expiry_date) {
          throw new Error(`Expiry date is required for line ${lineIndex + 1}`);
        }
      }
    }
    return lines;
  };

  const handleSave = async (postAfterSave: boolean) => {
    try {
      const lines = validateDraft();
      setSaving(true);
      setError(null);

      let result: Grn;
      if (mode === "edit" && grnId) {
        const payload: UpdateGrnPayload = {
          purchase_bill_id: selectedBillId ? Number(selectedBillId) : null,
          received_date: receivedDate,
          remarks: remarks || undefined,
          lines,
        };
        result = await apiClient.updateGrn(grnId, payload);
      } else if (source === "bill" && selectedBillId) {
        const payload: CreateGrnFromBillPayload = {
          purchase_order_id: selectedPoId ? Number(selectedPoId) : undefined,
          received_date: receivedDate,
          remarks: remarks || undefined,
          lines,
        };
        result = await apiClient.createGrnFromBill(Number(selectedBillId), payload);
      } else {
        const payload: CreateGrnFromPoPayload = {
          purchase_bill_id: selectedBillId ? Number(selectedBillId) : null,
          received_date: receivedDate,
          remarks: remarks || undefined,
          lines,
        };
        result = await apiClient.createGrnFromPo(Number(selectedPoId), payload);
      }

      if (postAfterSave) {
        result = await apiClient.postGrn(result.id);
      }

      router.push(`/purchase/grn/${result.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save GRN");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelDraft = async () => {
    if (!grnId) {
      return;
    }
    try {
      setSaving(true);
      await apiClient.cancelGrn(grnId);
      router.push(`/purchase/grn/${grnId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel GRN");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <AppPageHeader
        title={mode === "edit" ? `Edit ${existingGrn?.grn_number ?? "GRN"}` : source === "bill" ? "Create GRN From Bill" : "Create GRN From PO"}
        description="Capture received products with batch-level breakdown, then save draft or post stock inward."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/purchase/grn">Back to GRN List</Link>
            </Button>
            {mode === "edit" && grnId && hasPermission("grn:cancel") ? (
              <Button
                variant="outline"
                onClick={() => void handleCancelDraft()}
                disabled={saving}
                data-testid="cancel-grn"
              >
                Cancel Draft
              </Button>
            ) : null}
            {hasPermission(mode === "edit" ? "grn:edit" : "grn:create") ? (
              <Button
                variant="outline"
                onClick={() => void handleSave(false)}
                disabled={saving}
                data-testid={mode === "edit" ? "update-grn" : "create-grn-from-po"}
              >
                {mode === "edit" ? "Update Draft" : "Save Draft"}
              </Button>
            ) : null}
            {hasPermission("grn:post") ? (
              <Button
                onClick={() => void handleSave(true)}
                disabled={saving}
                data-testid="post-grn"
              >
                {mode === "edit" ? "Update & Post" : "Save & Post"}
              </Button>
            ) : null}
          </>
        }
      />

      <AppSectionCard title="Document Context" description="Select the source purchase order or bill, then capture receipt details.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ErpCombobox
            options={poOptions}
            value={selectedPoId}
            onValueChange={setSelectedPoId}
            placeholder="Select purchase order"
            searchPlaceholder="Search PO"
            emptyMessage="No purchase orders"
            data-testid="grn-po-select"
          />
          <ErpCombobox
            options={[{ label: "No purchase bill linked", value: "" }, ...billOptions]}
            value={selectedBillId}
            onValueChange={setSelectedBillId}
            placeholder="Attach purchase bill"
            searchPlaceholder="Search bill"
            emptyMessage="No purchase bills"
            data-testid="grn-bill-select"
          />
          <Input type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} />
          <Input placeholder="Remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} />
        </div>
        {selectedPo ? (
          <div className="grid gap-4 rounded-xl border border-border bg-[hsl(var(--muted-bg))] p-4 md:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Supplier</p>
              <p className="text-sm font-medium">{selectedPo.supplier_name ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Warehouse</p>
              <p className="text-sm font-medium">{selectedPo.warehouse_name ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">PO Status</p>
              <p className="text-sm font-medium">{selectedPo.status}</p>
            </div>
          </div>
        ) : null}
      </AppSectionCard>

      <AppSectionCard title="Received Lines" description="Split each received product across one or more batches and expiry dates.">
        {loading ? <p className="text-sm text-muted-foreground">Loading GRN draft...</p> : null}
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        {!loading && !lineDrafts.length ? (
          <p className="text-sm text-muted-foreground">Select a purchase order or purchase bill to start receiving.</p>
        ) : null}
        <div className="space-y-4">
          {lineDrafts.map((line, lineIndex) => {
            const receivedTotal = sumBatchValues(line.batch_rows, "received_qty");
            const freeTotal = sumBatchValues(line.batch_rows, "free_qty");
            return (
              <div key={`${line.po_line_id ?? "line"}-${lineIndex}`} className="rounded-2xl border border-border">
                <div className="grid gap-4 border-b border-border/70 bg-[hsl(var(--muted-bg))] p-4 md:grid-cols-5">
                  <div className="md:col-span-2">
                    <p className="text-sm font-semibold">{line.product_name}</p>
                    <p className="text-xs text-muted-foreground">Ordered {line.ordered_qty} · Already Received {line.already_received_qty} · Pending {line.pending_qty}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">This GRN Qty</p>
                    <p className="text-sm font-medium">{receivedTotal || 0}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Free Qty</p>
                    <p className="text-sm font-medium">{freeTotal || 0}</p>
                  </div>
                  <Input
                    placeholder="Line remarks"
                    value={line.remarks}
                    onChange={(event) => updateLine(lineIndex, { remarks: event.target.value })}
                  />
                </div>
                <div className="p-4">
                  <div className="mb-3 flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => addBatchRow(lineIndex)}>
                      Add Batch Row
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Batch No</TableHead>
                        <TableHead>Expiry</TableHead>
                        <TableHead>MFG</TableHead>
                        <TableHead>Received Qty</TableHead>
                        <TableHead>Free Qty</TableHead>
                        <TableHead>MRP</TableHead>
                        <TableHead>Unit Cost</TableHead>
                        <TableHead>Remarks</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {line.batch_rows.map((batch, batchIndex) => (
                        <TableRow key={`${lineIndex}-${batchIndex}`}>
                          <TableCell>
                            <Input
                              value={batch.batch_no}
                              onChange={(event) => updateBatch(lineIndex, batchIndex, { batch_no: event.target.value })}
                              placeholder="Batch no"
                              data-testid={`grn-line-batch-${lineIndex}-${batchIndex}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="date"
                              value={batch.expiry_date}
                              onChange={(event) => updateBatch(lineIndex, batchIndex, { expiry_date: event.target.value })}
                              data-testid={`grn-line-expiry-${lineIndex}-${batchIndex}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input type="date" value={batch.mfg_date} onChange={(event) => updateBatch(lineIndex, batchIndex, { mfg_date: event.target.value })} />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.001"
                              value={batch.received_qty}
                              onChange={(event) => updateBatch(lineIndex, batchIndex, { received_qty: event.target.value })}
                              data-testid={`grn-line-qty-${lineIndex}-${batchIndex}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input type="number" step="0.001" value={batch.free_qty} onChange={(event) => updateBatch(lineIndex, batchIndex, { free_qty: event.target.value })} />
                          </TableCell>
                          <TableCell>
                            <Input type="number" step="0.01" value={batch.mrp} onChange={(event) => updateBatch(lineIndex, batchIndex, { mrp: event.target.value })} />
                          </TableCell>
                          <TableCell>
                            <Input type="number" step="0.0001" value={batch.unit_cost} onChange={(event) => updateBatch(lineIndex, batchIndex, { unit_cost: event.target.value })} />
                          </TableCell>
                          <TableCell>
                            <Input value={batch.remarks} onChange={(event) => updateBatch(lineIndex, batchIndex, { remarks: event.target.value })} placeholder="Remarks" />
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" onClick={() => removeBatchRow(lineIndex, batchIndex)}>
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })}
        </div>
      </AppSectionCard>

      <AppActionBar>
        <p className="mr-auto text-sm text-muted-foreground">
          Sum of batch rows drives each GRN line. Save draft for review or post to create immutable stock inward entries.
        </p>
        {mode === "edit" && existingGrn ? (
          <Button variant="outline" onClick={() => setHistoryOpen(true)}>
            History
          </Button>
        ) : null}
      </AppActionBar>

      {mode === "edit" && existingGrn ? (
        <RecordHistoryDrawer
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          entityType="GRN"
          entityId={existingGrn.id}
          title="GRN History"
        />
      ) : null}
    </div>
  );
}
