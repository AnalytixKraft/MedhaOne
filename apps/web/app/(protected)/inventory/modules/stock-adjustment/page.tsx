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
  type StockAdjustmentReason,
  type StockAdjustmentRecord,
  type StockAdjustmentType,
  type Warehouse,
} from "@/lib/api/client";
import { formatQuantity } from "@/lib/quantity";

const reasons: StockAdjustmentReason[] = [
  "STOCK_COUNT_CORRECTION",
  "DAMAGED",
  "EXPIRED",
  "FOUND_STOCK",
  "OPENING_BALANCE_FIX",
  "THEFT",
  "BREAKAGE",
  "OTHER",
];

type AdjustmentDraft = {
  adjustmentType: StockAdjustmentType;
  qty: string;
  reason: StockAdjustmentReason;
  remarks: string;
};

const emptyDraft: AdjustmentDraft = {
  adjustmentType: "POSITIVE",
  qty: "",
  reason: "STOCK_COUNT_CORRECTION",
  remarks: "",
};

const selectClassName =
  "h-11 w-full rounded-xl border border-[hsl(var(--card-border))] bg-background px-3 text-sm text-foreground shadow-sm outline-none transition focus:border-[hsl(var(--primary-btn))] focus:ring-2 focus:ring-[hsl(var(--primary-btn))]/20";

function parsePositiveNumber(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export default function StockAdjustmentPage() {
  const { user, hasPermission } = usePermissions();
  const canView = !!user && (user.is_superuser || hasPermission("stock_adjustment:view"));
  const canApply = !!user && (user.is_superuser || hasPermission("stock_adjustment:apply"));

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [productId, setProductId] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<InventoryStockItem[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<InventoryStockItem | null>(null);
  const [draft, setDraft] = useState<AdjustmentDraft>(emptyDraft);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [recentAdjustments, setRecentAdjustments] = useState<StockAdjustmentRecord[]>([]);
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
      const [stockRows, adjustments] = await Promise.all([
        apiClient.getInventoryStockItems({
          warehouse_id: warehouseId || undefined,
          product_id: productId || undefined,
          search: search.trim() || undefined,
          page: 1,
          page_size: 50,
        }),
        apiClient.listStockAdjustments({ page: 1, page_size: 10 }),
      ]);
      setRows(stockRows.data);
      setRecentAdjustments(adjustments.data);
    } catch (caught) {
      setRows([]);
      setRecentAdjustments([]);
      setRowsError(caught instanceof Error ? caught.message : "Failed to load stock adjustment data.");
    } finally {
      setLoadingRows(false);
    }
  }, [canView, productId, search, warehouseId]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const beforeQty = selected ? Number(selected.qty_on_hand) : 0;
  const adjustmentQty = parsePositiveNumber(draft.qty) ?? 0;
  const afterQty =
    draft.adjustmentType === "POSITIVE" ? beforeQty + adjustmentQty : beforeQty - adjustmentQty;

  const submitAdjustment = async () => {
    if (!selected) {
      setResult({ ok: false, message: "Select a stock row first." });
      return;
    }
    if (!canApply) {
      setResult({ ok: false, message: "You do not have permission to apply stock adjustments." });
      return;
    }
    const qty = parsePositiveNumber(draft.qty);
    if (qty === null) {
      setResult({ ok: false, message: "Quantity must be greater than zero." });
      return;
    }
    const availableQty = parsePositiveNumber(selected.qty_on_hand) ?? 0;
    if (draft.adjustmentType === "NEGATIVE" && qty > availableQty) {
      setResult({ ok: false, message: "Negative adjustment cannot reduce below available stock." });
      return;
    }
    if (draft.reason === "OTHER" && !draft.remarks.trim()) {
      setResult({ ok: false, message: "Remarks are required when reason is OTHER." });
      return;
    }

    setSubmitting(true);
    setResult(null);
    try {
      const response = await apiClient.createStockAdjustment({
        warehouse_id: selected.warehouse_id,
        product_id: selected.product_id,
        batch_id: selected.batch_id,
        adjustment_type: draft.adjustmentType,
        qty: draft.qty.trim(),
        reason: draft.reason,
        remarks: draft.remarks.trim() || undefined,
      });
      setResult({
        ok: true,
        message: `Adjustment posted. Ref ${response.reference_id}. Before ${response.before_qty}, after ${response.after_qty}.`,
      });
      setSelected(null);
      setDraft(emptyDraft);
      await loadRows();
    } catch (caught) {
      setResult({
        ok: false,
        message: caught instanceof Error ? caught.message : "Failed to apply stock adjustment.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!canView) {
    return (
      <div className="space-y-4">
        <PageTitle
          title="Stock Adjustment"
          description="Correct actual stock quantity when physical stock differs from system stock."
        />
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            You do not have permission to view stock adjustments.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Stock Adjustment"
        description="Adjust actual quantity when physical stock differs from system stock."
      />

      <AppSectionCard title="Find Stock Bucket" description="Locate the exact stock bucket to adjust before posting the quantity change.">
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
                data-testid="stock-adjustment-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by SKU, product, batch, warehouse"
              />
            </label>
        </AppFormGrid>

        {rowsError ? <p className="text-sm text-rose-600">{rowsError}</p> : null}

        <div className="overflow-auto rounded-xl border border-[hsl(var(--card-border))]">
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">Qty On Hand</TableHead>
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
                    <TableCell className="text-right">
                      {formatQuantity(row.qty_on_hand, precisionByProduct[row.product_id] ?? row.quantity_precision)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="stock-adjustment-select-row"
                        onClick={() => setSelected(row)}
                      >
                        Adjust
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!loadingRows && rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                      No stock rows found.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
        </div>
      </AppSectionCard>

      <AppSectionCard title="Apply Adjustment" description="Post a positive or negative quantity correction against the selected stock bucket.">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Select a stock row to apply an adjustment.</p>
          ) : (
            <>
              <AppSummaryPanel className="border border-[hsl(var(--card-border))] bg-[hsl(var(--muted-bg))] shadow-none">
                <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Warehouse</p>
                  <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">{selected.warehouse_name}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Product</p>
                  <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">{selected.product_name}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Batch</p>
                  <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">{selected.batch_no}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Expiry</p>
                  <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">{selected.expiry_date}</p>
                </div>
                </div>
              </AppSummaryPanel>

              <AppFormGrid className="md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Adjustment Type</span>
                  <select
                    data-testid="stock-adjustment-type"
                    value={draft.adjustmentType}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        adjustmentType: event.target.value as StockAdjustmentType,
                      }))
                    }
                    className={selectClassName}
                  >
                    <option value="POSITIVE">Positive</option>
                    <option value="NEGATIVE">Negative</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Quantity</span>
                  <Input
                    data-testid="stock-adjustment-qty"
                    value={draft.qty}
                    onChange={(event) => setDraft((current) => ({ ...current, qty: event.target.value }))}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Reason</span>
                  <select
                    data-testid="stock-adjustment-reason"
                    value={draft.reason}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        reason: event.target.value as StockAdjustmentReason,
                      }))
                    }
                    className={selectClassName}
                  >
                    {reasons.map((reason) => (
                      <option key={reason} value={reason}>
                        {reason}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Remarks</span>
                  <Input
                    data-testid="stock-adjustment-remarks"
                    value={draft.remarks}
                    onChange={(event) => setDraft((current) => ({ ...current, remarks: event.target.value }))}
                    placeholder={draft.reason === "OTHER" ? "Required for OTHER" : "Optional"}
                  />
                </label>
              </AppFormGrid>

              <AppSummaryPanel className="border border-[hsl(var(--card-border))] shadow-none">
                <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Before Qty</p>
                  <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">
                    {formatQuantity(selected.qty_on_hand, precisionByProduct[selected.product_id] ?? selected.quantity_precision)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">After Qty Preview</p>
                  <p className={`mt-1 text-sm font-medium ${afterQty < 0 ? "text-rose-600" : "text-[hsl(var(--text-primary))]"}`}>
                    {afterQty.toFixed(precisionByProduct[selected.product_id] ?? selected.quantity_precision)}
                  </p>
                </div>
                </div>
              </AppSummaryPanel>
            </>
          )}

          {!canApply ? (
            <p className="text-sm text-muted-foreground">
              You have read-only access. Applying adjustments requires <code>stock_adjustment:apply</code>.
            </p>
          ) : null}

          {result ? (
            <p
              data-testid="stock-adjustment-result"
              className={result.ok ? "text-sm text-emerald-600" : "text-sm text-rose-600"}
            >
              {result.message}
            </p>
          ) : null}

          <AppActionBar>
            <Button
              type="button"
              data-testid="stock-adjustment-submit"
              onClick={submitAdjustment}
              disabled={!selected || submitting || !canApply}
            >
              {submitting ? "Posting..." : "Apply Stock Adjustment"}
            </Button>
          </AppActionBar>
      </AppSectionCard>

      <AppTable title="Recent Stock Adjustments" description="Recent quantity corrections with history access for audit review.">
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Before / After</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">History</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentAdjustments.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.reference_id}</TableCell>
                    <TableCell>
                      {item.product_name}
                      <div className="text-xs text-muted-foreground">{item.sku}</div>
                    </TableCell>
                    <TableCell>{item.warehouse_name}</TableCell>
                    <TableCell>
                      {item.batch_no}
                      <div className="text-xs text-muted-foreground">{item.expiry_date}</div>
                    </TableCell>
                    <TableCell>{item.adjustment_type}</TableCell>
                    <TableCell className="text-right">{item.qty}</TableCell>
                    <TableCell>{item.reason}</TableCell>
                    <TableCell>
                      {item.before_qty} → {item.after_qty}
                    </TableCell>
                    <TableCell>{new Date(item.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="outline" size="sm" onClick={() => setHistoryTarget(item.id)}>
                        History
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {recentAdjustments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-sm text-muted-foreground">
                      No stock adjustments recorded yet.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
      </AppTable>

      <RecordHistoryDrawer
        open={historyTarget !== null}
        onClose={() => setHistoryTarget(null)}
        entityType="STOCK_ADJUSTMENT"
        entityId={historyTarget}
        title="Stock Adjustment History"
      />
    </div>
  );
}
