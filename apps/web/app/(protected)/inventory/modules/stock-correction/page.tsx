"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { RecordHistoryDrawer } from "@/components/audit/record-history-drawer";
import { usePermissions } from "@/components/auth/permission-provider";
import {
  AppActionBar,
  AppFormGrid,
  AppSectionCard,
  AppSummaryPanel,
  AppTable,
} from "@/components/erp/app-primitives";
import { PageTitle } from "@/components/layout/page-title";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  apiClient,
  type InventoryStockItem,
  type Product,
  type StockCorrectionRecord,
  type Warehouse,
} from "@/lib/api/client";
import { formatQuantity } from "@/lib/quantity";

type CorrectionDraft = {
  qtyToReclassify: string;
  correctedBatchNo: string;
  correctedExpiryDate: string;
  correctedMfgDate: string;
  correctedMrp: string;
  correctedReferenceId: string;
  referenceId: string;
  reason: string;
  remarks: string;
};

const emptyDraft: CorrectionDraft = {
  qtyToReclassify: "",
  correctedBatchNo: "",
  correctedExpiryDate: "",
  correctedMfgDate: "",
  correctedMrp: "",
  correctedReferenceId: "",
  referenceId: "",
  reason: "",
  remarks: "",
};

const selectClassName =
  "h-11 w-full rounded-xl border border-[hsl(var(--card-border))] bg-background px-3 text-sm text-foreground shadow-sm outline-none transition focus:border-[hsl(var(--primary-btn))] focus:ring-2 focus:ring-[hsl(var(--primary-btn))]/20";

const textareaClassName =
  "min-h-24 w-full rounded-xl border border-[hsl(var(--card-border))] bg-background px-3 py-2.5 text-sm text-foreground shadow-sm outline-none transition focus:border-[hsl(var(--primary-btn))] focus:ring-2 focus:ring-[hsl(var(--primary-btn))]/20";

function parsePositiveNumber(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normalizeDateInput(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  const ddmmyyyy = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

export default function StockCorrectionPage() {
  const { user, hasPermission } = usePermissions();
  const canView = !!user && (user.is_superuser || hasPermission("stock_correction:view"));
  const canApply = !!user && (user.is_superuser || hasPermission("stock_correction:apply"));

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [productId, setProductId] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<InventoryStockItem[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<InventoryStockItem | null>(null);
  const [draft, setDraft] = useState<CorrectionDraft>(emptyDraft);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [recentCorrections, setRecentCorrections] = useState<StockCorrectionRecord[]>([]);
  const [historyTarget, setHistoryTarget] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadMasters() {
      try {
        const [warehouseResponse, productResponse] = await Promise.all([
          apiClient.listWarehouses(),
          apiClient.listProducts(),
        ]);
        if (!cancelled) {
          setWarehouses(warehouseResponse);
          setProducts(productResponse);
        }
      } catch {
        if (!cancelled) {
          setWarehouses([]);
          setProducts([]);
        }
      }
    }
    void loadMasters();
    return () => {
      cancelled = true;
    };
  }, []);

  const precisionByProduct = useMemo(
    () =>
      products.reduce<Record<number, number>>((accumulator, product) => {
        accumulator[product.id] = product.quantity_precision;
        return accumulator;
      }, {}),
    [products],
  );

  const loadRows = useCallback(async () => {
    if (!canView) {
      setRows([]);
      setLoadingRows(false);
      return;
    }
    setLoadingRows(true);
    setRowsError(null);
    try {
      const [stockRows, corrections] = await Promise.all([
        apiClient.getInventoryStockItems({
          warehouse_id: warehouseId || undefined,
          product_id: productId || undefined,
          search: search.trim() || undefined,
          page: 1,
          page_size: 50,
        }),
        apiClient.listStockCorrections({ page: 1, page_size: 10 }),
      ]);
      setRows(stockRows.data);
      setRecentCorrections(corrections.data);
    } catch (caught) {
      setRows([]);
      setRecentCorrections([]);
      setRowsError(caught instanceof Error ? caught.message : "Failed to load stock correction data.");
    } finally {
      setLoadingRows(false);
    }
  }, [canView, productId, search, warehouseId]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const selectRow = (row: InventoryStockItem) => {
    setSelected(row);
    setResult(null);
    setDraft({
      qtyToReclassify: row.qty_on_hand,
      correctedBatchNo: row.batch_no,
      correctedExpiryDate: row.expiry_date,
      correctedMfgDate: row.mfg_date ?? "",
      correctedMrp: row.mrp ?? "",
      correctedReferenceId: row.reference_id ?? "",
      referenceId: "",
      reason: "",
      remarks: "",
    });
  };

  const submitCorrection = async () => {
    if (!selected) {
      setResult({ ok: false, message: "Select a source stock bucket first." });
      return;
    }
    if (!canApply) {
      setResult({ ok: false, message: "You do not have permission to apply stock corrections." });
      return;
    }

    const qtyToReclassify = parsePositiveNumber(draft.qtyToReclassify);
    if (qtyToReclassify === null) {
      setResult({ ok: false, message: "Qty to reclassify must be greater than zero." });
      return;
    }
    const sourceQty = parsePositiveNumber(selected.qty_on_hand);
    if (sourceQty !== null && qtyToReclassify > sourceQty) {
      setResult({ ok: false, message: "Qty to reclassify cannot exceed source qty on hand." });
      return;
    }

    const correctedExpiryDate = normalizeDateInput(draft.correctedExpiryDate);
    if (!correctedExpiryDate) {
      setResult({ ok: false, message: "Corrected expiry must be in YYYY-MM-DD or DD/MM/YYYY format." });
      return;
    }
    const correctedMfgDate = draft.correctedMfgDate
      ? normalizeDateInput(draft.correctedMfgDate)
      : null;
    if (draft.correctedMfgDate && !correctedMfgDate) {
      setResult({ ok: false, message: "MFG date must be in YYYY-MM-DD or DD/MM/YYYY format." });
      return;
    }
    if (!draft.correctedBatchNo.trim()) {
      setResult({ ok: false, message: "Corrected batch number is required." });
      return;
    }
    if (!draft.reason.trim()) {
      setResult({ ok: false, message: "Reason is required." });
      return;
    }

    const metadataChanged =
      draft.correctedBatchNo.trim() !== selected.batch_no ||
      correctedExpiryDate !== selected.expiry_date ||
      (correctedMfgDate || "") !== (selected.mfg_date || "") ||
      (draft.correctedMrp.trim() || "") !== (selected.mrp || "") ||
      (draft.correctedReferenceId.trim() || "") !== (selected.reference_id || "");

    if (!metadataChanged) {
      setResult({ ok: false, message: "At least one corrected metadata field must differ from source." });
      return;
    }

    setSubmitting(true);
    setResult(null);
    try {
      const response = await apiClient.createStockCorrection({
        warehouse_id: selected.warehouse_id,
        product_id: selected.product_id,
        source_batch_id: selected.batch_id,
        qty_to_reclassify: draft.qtyToReclassify.trim(),
        corrected_batch_no: draft.correctedBatchNo.trim(),
        corrected_expiry_date: correctedExpiryDate,
        corrected_mfg_date: correctedMfgDate || undefined,
        corrected_mrp: draft.correctedMrp.trim() || undefined,
        corrected_reference_id: draft.correctedReferenceId.trim() || undefined,
        reference_id: draft.referenceId.trim() || undefined,
        reason: draft.reason.trim(),
        remarks: draft.remarks.trim() || undefined,
      });
      setResult({
        ok: true,
        message: `Reclassification posted. Ref ${response.reference_id}. Source ${response.source_qty_on_hand}, corrected ${response.corrected_qty_on_hand}. Net stock change 0.`,
      });
      setSelected(null);
      setDraft(emptyDraft);
      await loadRows();
    } catch (caught) {
      setResult({
        ok: false,
        message: caught instanceof Error ? caught.message : "Failed to apply stock correction.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!canView) {
    return (
      <div className="space-y-4">
        <PageTitle
          title="Stock Correction"
          description="Reclassify stock between metadata buckets without changing total stock."
        />
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            You do not have permission to view stock corrections.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Stock Correction"
        description="Reclassify stock metadata by moving quantity from a source bucket to a corrected bucket."
      />

      <AppSectionCard title="Find Source Stock" description="Select the source metadata bucket, then reclassify quantity into the corrected batch details without changing net stock.">
        <AppFormGrid className="md:grid-cols-3">
            <label className="space-y-1">
              <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Warehouse</span>
              <select
                value={warehouseId}
                onChange={(event) => setWarehouseId(event.target.value)}
                className={selectClassName}
              >
                <option value="">All Warehouses</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Product</span>
              <select
                value={productId}
                onChange={(event) => setProductId(event.target.value)}
                className={selectClassName}
              >
                <option value="">All Products</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} ({product.sku})
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Search</span>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by SKU, product, batch, warehouse"
              />
            </label>
        </AppFormGrid>

        {rowsError ? <p className="text-sm text-rose-600">{rowsError}</p> : null}

        <div className="overflow-auto rounded-xl border border-[hsl(var(--card-border))]">
            <Table className="min-w-[1080px]">
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>MFG</TableHead>
                  <TableHead>MRP</TableHead>
                  <TableHead>Reference ID</TableHead>
                  <TableHead className="text-right">Qty Available</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.warehouse_id}-${row.batch_id}`}>
                    <TableCell>{row.sku}</TableCell>
                    <TableCell>{row.product_name}</TableCell>
                    <TableCell>{row.warehouse_name}</TableCell>
                    <TableCell>{row.batch_no}</TableCell>
                    <TableCell>{row.expiry_date}</TableCell>
                    <TableCell>{row.mfg_date || "-"}</TableCell>
                    <TableCell>{row.mrp || "-"}</TableCell>
                    <TableCell>{row.reference_id || "-"}</TableCell>
                    <TableCell className="text-right">
                      {formatQuantity(row.qty_on_hand, precisionByProduct[row.product_id] ?? row.quantity_precision)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="outline" size="sm" onClick={() => selectRow(row)}>
                        Reclassify
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!loadingRows && rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-sm text-muted-foreground">
                      No stock rows found.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
        </div>
      </AppSectionCard>

      <AppSectionCard title="Apply Stock Correction" description="Post a paired OUT and IN ledger reclassification in one transaction to preserve immutable stock history.">
          <p className="text-sm text-muted-foreground">
            This moves stock from the selected batch/expiry to the corrected batch/expiry without changing total stock.
          </p>

          {!selected ? (
            <p className="text-sm text-muted-foreground">Select a source stock bucket to continue.</p>
          ) : (
            <>
              <AppSummaryPanel className="border border-[hsl(var(--card-border))] bg-[hsl(var(--muted-bg))] shadow-none">
                <div className="grid gap-3 md:grid-cols-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Product</p>
                  <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">{selected.product_name}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Warehouse</p>
                  <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">{selected.warehouse_name}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Source Batch</p>
                  <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">{selected.batch_no}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Source Expiry</p>
                  <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">{selected.expiry_date}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Qty Available</p>
                  <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">
                    {formatQuantity(
                      selected.qty_on_hand,
                      precisionByProduct[selected.product_id] ?? selected.quantity_precision,
                    )}
                  </p>
                </div>
                </div>
              </AppSummaryPanel>

              <AppFormGrid className="md:grid-cols-3">
                <label className="space-y-1">
                  <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Qty To Reclassify</span>
                  <Input
                    value={draft.qtyToReclassify}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, qtyToReclassify: event.target.value }))
                    }
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Corrected Batch No</span>
                  <Input
                    value={draft.correctedBatchNo}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, correctedBatchNo: event.target.value }))
                    }
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Corrected Expiry</span>
                  <Input
                    type="date"
                    value={draft.correctedExpiryDate}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, correctedExpiryDate: event.target.value }))
                    }
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">MFG Date (optional)</span>
                  <Input
                    type="date"
                    value={draft.correctedMfgDate}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, correctedMfgDate: event.target.value }))
                    }
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">MRP (optional)</span>
                  <Input
                    value={draft.correctedMrp}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, correctedMrp: event.target.value }))
                    }
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Reference ID (optional)</span>
                  <Input
                    value={draft.correctedReferenceId}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        correctedReferenceId: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Correction Ref ID (optional)</span>
                  <Input
                    value={draft.referenceId}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, referenceId: event.target.value }))
                    }
                  />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Reason</span>
                  <Input
                    value={draft.reason}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, reason: event.target.value }))
                    }
                    placeholder="Why is this metadata being corrected?"
                  />
                </label>
                <label className="space-y-1 md:col-span-3">
                  <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Remarks</span>
                  <textarea
                    value={draft.remarks}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, remarks: event.target.value }))
                    }
                    className={textareaClassName}
                    placeholder="Additional correction notes"
                  />
                </label>
              </AppFormGrid>

              <AppSummaryPanel className="border border-emerald-200 bg-emerald-50 shadow-none dark:border-emerald-500/20 dark:bg-emerald-500/10">
                <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
                  Net stock change preview: 0. This operation posts one ledger OUT and one ledger IN in the same transaction.
                </p>
              </AppSummaryPanel>
            </>
          )}

          {!canApply ? (
            <p className="text-sm text-muted-foreground">
              You have read-only access. Applying corrections requires <code>stock_correction:apply</code>.
            </p>
          ) : null}

          {result ? (
            <p className={result.ok ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>
              {result.message}
            </p>
          ) : null}

          <AppActionBar>
            <Button type="button" onClick={submitCorrection} disabled={!selected || submitting || !canApply}>
              {submitting ? "Posting..." : "Apply Stock Correction"}
            </Button>
          </AppActionBar>
      </AppSectionCard>

      <AppTable title="Recent Stock Corrections" description="Recent metadata reclassifications with linked record history for traceability.">
            <Table className="min-w-[920px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Corrected</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">History</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentCorrections.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.reference_id}</TableCell>
                    <TableCell>
                      {item.product_name}
                      <div className="text-xs text-muted-foreground">{item.sku}</div>
                    </TableCell>
                    <TableCell>{item.warehouse_name}</TableCell>
                    <TableCell>
                      {item.source_batch_no}
                      <div className="text-xs text-muted-foreground">{item.source_expiry_date}</div>
                    </TableCell>
                    <TableCell>
                      {item.corrected_batch_no}
                      <div className="text-xs text-muted-foreground">{item.corrected_expiry_date}</div>
                    </TableCell>
                    <TableCell className="text-right">{item.qty_to_reclassify}</TableCell>
                    <TableCell>{item.reason}</TableCell>
                    <TableCell>{new Date(item.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="outline" size="sm" onClick={() => setHistoryTarget(item.id)}>
                        History
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {recentCorrections.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                      No stock corrections recorded yet.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
      </AppTable>

      <RecordHistoryDrawer
        open={historyTarget !== null}
        onClose={() => setHistoryTarget(null)}
        entityType="STOCK_CORRECTION"
        entityId={historyTarget}
        title="Stock Correction History"
      />
    </div>
  );
}
