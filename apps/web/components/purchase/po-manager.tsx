"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { usePermissions } from "@/components/auth/permission-provider";
import {
  PurchaseOrderSummary,
  type PurchaseOrderTaxOption,
} from "@/components/purchase/purchase-order-summary";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  PurchaseOrder,
  PurchaseOrderLinePayload,
  type PurchaseTaxType,
  apiClient,
  Party,
  Product,
  TaxRate,
  Warehouse,
} from "@/lib/api/client";
import { formatQuantity } from "@/lib/quantity";
import {
  PurchaseLineDraft,
} from "@/components/purchase/purchase-line-row";
import { PurchaseLineGrid } from "@/components/purchase/purchase-line-grid";

type LineAction =
  | { type: "update"; lineId: string; patch: Partial<PurchaseLineDraft> }
  | { type: "add"; line: PurchaseLineDraft; afterLineId?: string }
  | { type: "remove"; lineId: string }
  | { type: "reset"; line: PurchaseLineDraft };

const amountFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseDecimalInput(value: string) {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized === "-" ||
    normalized === "." ||
    normalized === "-."
  ) {
    return 0;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTaxLabelForType(
  label: string | null | undefined,
  percent: number,
  taxType: PurchaseTaxType,
) {
  const cleaned = (label ?? "").trim();
  const percentText = percentFormatter.format(percent);

  if (!cleaned) {
    return `${taxType} ${percentText}%`;
  }

  if (/\bGST\b/i.test(cleaned)) {
    return cleaned.replace(/\bGST\b/gi, taxType);
  }

  return cleaned;
}

function lineReducer(state: PurchaseLineDraft[], action: LineAction) {
  switch (action.type) {
    case "update":
      return state.map((line) =>
        line.id === action.lineId ? { ...line, ...action.patch } : line,
      );
    case "add": {
      if (!action.afterLineId) {
        return [...state, action.line];
      }

      const index = state.findIndex((line) => line.id === action.afterLineId);
      if (index === -1) {
        return [...state, action.line];
      }

      const next = [...state];
      next.splice(index + 1, 0, action.line);
      return next;
    }
    case "remove":
      if (state.length === 1) {
        return [
          {
            ...state[0],
            product_id: "",
            product_query: "",
            batch: "",
            expiry: "",
            ordered_qty: "",
            unit_cost: "",
            free_qty: "0",
          },
        ];
      }
      return state.filter((line) => line.id !== action.lineId);
    case "reset":
      return [action.line];
    default:
      return state;
  }
}

export function PurchaseOrderManager() {
  const { hasPermission, loading: permissionLoading } = usePermissions();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [discountPercentInput, setDiscountPercentInput] = useState("0");
  const [taxType, setTaxType] = useState<PurchaseTaxType>("TDS");
  const [selectedTaxName, setSelectedTaxName] = useState("");
  const [adjustmentInput, setAdjustmentInput] = useState("0");
  const [orderDate, setOrderDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextLineId = useRef(1);

  const createEmptyLine = useCallback(
    (seed?: Partial<PurchaseLineDraft>): PurchaseLineDraft => ({
      id: `po-line-${nextLineId.current++}`,
      product_id: "",
      product_query: "",
      batch: "",
      expiry: "",
      ordered_qty: "",
      unit_cost: "",
      free_qty: "0",
      ...seed,
    }),
    [],
  );

  const [lines, dispatch] = useReducer(lineReducer, undefined, () => [
    createEmptyLine(),
  ]);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const [poRes, parties, warehouseRes, productRes, taxRateRes] = await Promise.all([
        apiClient.listPurchaseOrders(),
        apiClient.listParties(),
        apiClient.listWarehouses(),
        apiClient.listProducts(),
        apiClient.listTaxRates(),
      ]);
      setPurchaseOrders(poRes.items);
      setSuppliers(parties);
      setWarehouses(warehouseRes);
      setProducts(productRes);
      setTaxRates(taxRateRes);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load purchase data",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateLine = useCallback(
    (lineId: string, patch: Partial<PurchaseLineDraft>) => {
      dispatch({ type: "update", lineId, patch });
    },
    [],
  );

  const addLine = useCallback(() => {
    const line = createEmptyLine();
    dispatch({ type: "add", line });
    return line.id;
  }, [createEmptyLine]);

  const duplicateLine = useCallback(
    (source: PurchaseLineDraft) => {
      const line = createEmptyLine(
        {
          product_id: source.product_id,
          product_query: source.product_query,
          batch: source.batch,
          expiry: source.expiry,
          ordered_qty: source.ordered_qty,
          unit_cost: source.unit_cost,
          free_qty: source.free_qty,
        },
      );
      dispatch({ type: "add", line, afterLineId: source.id });
      return line.id;
    },
    [createEmptyLine],
  );

  const removeLine = useCallback((lineId: string) => {
    dispatch({ type: "remove", lineId });
  }, []);

  const resetForm = () => {
    setSupplierId("");
    setWarehouseId("");
    setDiscountPercentInput("0");
    setTaxType("TDS");
    setSelectedTaxName("");
    setAdjustmentInput("0");
    setOrderDate(new Date().toISOString().slice(0, 10));
    dispatch({ type: "reset", line: createEmptyLine() });
  };

  const handleCreatePo = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (!supplierId || !warehouseId) {
        throw new Error("Supplier and warehouse are required");
      }

      if (financeValidationMessage) {
        throw new Error(financeValidationMessage);
      }

      const linePayload: PurchaseOrderLinePayload[] = lines.map((line) => {
        if (!line.product_id || !line.ordered_qty) {
          throw new Error("Each line needs product and ordered quantity");
        }

        return {
          product_id: Number(line.product_id),
          ordered_qty: line.ordered_qty,
          unit_cost: line.unit_cost || undefined,
          free_qty: line.free_qty || "0",
        };
      });

      await apiClient.createPurchaseOrder({
        supplier_id: Number(supplierId),
        warehouse_id: Number(warehouseId),
        order_date: orderDate,
        subtotal,
        discount_percent: discountPercent,
        discount_amount: discountAmount,
        tax_type: taxType,
        tax_name: selectedTaxOption?.tax_name,
        tax_percent: taxPercent,
        tax_amount: taxAmount,
        adjustment: adjustmentAmount,
        total,
        lines: linePayload,
      });

      resetForm();
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create purchase order",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (poId: number) => {
    setError(null);
    try {
      await apiClient.approvePurchaseOrder(poId);
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to approve purchase order",
      );
    }
  };

  const totalQuantity = lines.reduce((sum, line) => {
    const quantity = Number.parseFloat(line.ordered_qty || "0");
    return sum + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);
  const totalQuantityDisplay = formatQuantity(
    totalQuantity,
    Number.isInteger(totalQuantity) ? 0 : 3,
  );

  const supplierOptions = useMemo(
    () =>
      suppliers.map((supplier) => ({
        label: supplier.name,
        value: String(supplier.id),
      })),
    [suppliers],
  );

  const warehouseOptions = useMemo(
    () =>
      warehouses.map((warehouse) => ({
        label: warehouse.name,
        value: String(warehouse.id),
      })),
    [warehouses],
  );

  const taxOptions = useMemo<PurchaseOrderTaxOption[]>(() => {
    return taxRates
      .filter((taxRate) => taxRate.is_active)
      .sort(
        (left, right) =>
          Number.parseFloat(left.rate_percent) - Number.parseFloat(right.rate_percent),
      )
      .map((taxRate) => {
        const taxPercent = Number.parseFloat(taxRate.rate_percent);
        const normalizedTaxPercent = Number.isFinite(taxPercent) ? taxPercent : 0;
        const label = normalizeTaxLabelForType(
          taxRate.label,
          normalizedTaxPercent,
          taxType,
        );

        return {
          label,
          value: String(taxRate.id),
          tax_name: label,
          tax_percent: normalizedTaxPercent,
        };
      });
  }, [taxRates, taxType]);

  const selectedTaxOption = useMemo(
    () => taxOptions.find((option) => option.value === selectedTaxName) ?? null,
    [selectedTaxName, taxOptions],
  );

  const subtotal = roundCurrency(
    lines.reduce((sum, line) => {
      const quantity = Number.parseFloat(line.ordered_qty || "0");
      const unitCost = Number.parseFloat(line.unit_cost || "0");
      return (
        sum +
        (Number.isFinite(quantity) ? quantity : 0) *
          (Number.isFinite(unitCost) ? unitCost : 0)
      );
    }, 0),
  );

  const rawDiscountPercent = parseDecimalInput(discountPercentInput);
  const discountPercent = Math.min(Math.max(rawDiscountPercent, 0), 100);
  const discountAmount = roundCurrency((subtotal * discountPercent) / 100);
  const taxableAmount = roundCurrency(Math.max(subtotal - discountAmount, 0));
  const taxPercent = selectedTaxOption?.tax_percent ?? 0;
  const taxMagnitude = roundCurrency((taxableAmount * taxPercent) / 100);
  const taxAmount = roundCurrency(taxType === "TDS" ? -taxMagnitude : taxMagnitude);
  const adjustmentAmount = roundCurrency(parseDecimalInput(adjustmentInput));
  const rawTotal = roundCurrency(
    subtotal - discountAmount + taxAmount + adjustmentAmount,
  );
  const total = Math.max(rawTotal, 0);

  const financeValidationMessage = useMemo(() => {
    if (rawDiscountPercent < 0 || rawDiscountPercent > 100) {
      return "Discount must be between 0% and 100%.";
    }

    if (rawTotal < 0) {
      return "Final total cannot be negative.";
    }

    return null;
  }, [rawDiscountPercent, rawTotal]);

  return (
    <div className="relative flex flex-col gap-5">
      {error ? (
        <p className="rounded-[10px] border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 shadow-[0_8px_24px_rgba(0,0,0,0.3)]">
          {error}
        </p>
      ) : null}
      {permissionLoading ? (
        <p className="text-sm text-[#9ca3af]">Loading permissions...</p>
      ) : hasPermission("purchase:create") ? (
        <form className="relative flex flex-col gap-5" onSubmit={handleCreatePo}>
          <Card className="relative overflow-hidden rounded-[12px] border border-white/10 bg-[linear-gradient(180deg,#111827,#0f172a)] shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
            <CardHeader className="border-b border-white/10 bg-[linear-gradient(110deg,rgba(31,41,55,0.95),rgba(17,24,39,0.98))] px-5 py-5 text-[#f9fafb]">
              <div className="flex flex-col gap-3">
                <div>
                  <CardTitle className="text-xl font-semibold tracking-[0.02em]">
                    Purchase Order Entry
                  </CardTitle>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[#9ca3af]">
                    Dense ERP line-entry workspace
                  </p>
                </div>
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1.4fr)_180px_120px_auto]">
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9ca3af]">
                      Supplier
                    </span>
                    <ErpCombobox
                      data-testid="po-supplier-select"
                      options={supplierOptions}
                      value={supplierId}
                      onValueChange={setSupplierId}
                      placeholder="Select supplier"
                      searchPlaceholder="Search supplier"
                      emptyMessage="No matching suppliers"
                      triggerClassName="h-11 rounded-[10px] border-white/10 bg-[#020617] px-3 text-sm text-[#f9fafb] shadow-none focus-visible:border-[#22C55E] focus-visible:ring-[#22C55E]/30"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9ca3af]">
                      Warehouse
                    </span>
                    <ErpCombobox
                      data-testid="po-warehouse-select"
                      options={warehouseOptions}
                      value={warehouseId}
                      onValueChange={setWarehouseId}
                      placeholder="Select warehouse"
                      searchPlaceholder="Search warehouse"
                      emptyMessage="No matching warehouses"
                      triggerClassName="h-11 rounded-[10px] border-white/10 bg-[#020617] px-3 text-sm text-[#f9fafb] shadow-none focus-visible:border-[#22C55E] focus-visible:ring-[#22C55E]/30"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9ca3af]">
                      PO Date
                    </span>
                    <Input
                      type="date"
                      value={orderDate}
                      onChange={(event) => setOrderDate(event.target.value)}
                      required
                      className="h-11 rounded-[10px] border-white/10 bg-[#020617] text-sm text-[#f9fafb] shadow-none transition-all duration-150 focus-visible:border-[#22C55E] focus-visible:ring-[#22C55E]/30 focus-visible:ring-offset-0 [&::-webkit-calendar-picker-indicator]:invert"
                    />
                  </label>

                  <div className="space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9ca3af]">
                      Status
                    </span>
                    <div className="flex h-11 items-center rounded-[10px] border border-[#22C55E]/35 bg-[#22C55E]/10 px-3 text-sm font-semibold text-[#bbf7d0]">
                      DRAFT
                    </div>
                  </div>

                  <div className="flex items-end justify-end">
                    <Button
                      type="button"
                      onClick={addLine}
                      className="h-11 rounded-[10px] border-0 bg-[linear-gradient(135deg,#22C55E,#16A34A)] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(34,197,94,0.35)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(34,197,94,0.45)]"
                    >
                      Add Row
                    </Button>
                  </div>
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card className="relative min-h-[280px] overflow-hidden rounded-[12px] border border-white/10 bg-[linear-gradient(180deg,#111827,#0f172a)] shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
            <CardHeader className="border-b border-white/10 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#9ca3af]">
                  Line Items
                </h3>
                <span className="text-xs text-[#9ca3af]">
                  Enter on Unit Cost adds the next row
                </span>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5 pt-4">
              <PurchaseLineGrid
                rows={lines}
                products={products}
                onUpdateLine={updateLine}
                onAddLine={addLine}
                onRemoveLine={removeLine}
                onDuplicateLine={duplicateLine}
                formatAmount={(value) => amountFormatter.format(value)}
              />
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="w-full max-w-[220px] rounded-[12px] border border-white/10 bg-[linear-gradient(180deg,#111827,#0f172a)] px-4 py-3 text-right shadow-[0_10px_28px_rgba(0,0,0,0.32)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9ca3af]">
                Total Qty
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-[#f9fafb]">
                {totalQuantityDisplay}
              </p>
            </div>

            <div className="flex w-full flex-col gap-3 xl:ml-auto xl:max-w-[420px]">
              <PurchaseOrderSummary
                subtotal={subtotal}
                discountPercentInput={discountPercentInput}
                onDiscountPercentChange={setDiscountPercentInput}
                discountAmount={discountAmount}
                taxType={taxType}
                onTaxTypeChange={setTaxType}
                taxOptions={taxOptions}
                selectedTaxName={selectedTaxName}
                onSelectedTaxNameChange={setSelectedTaxName}
                taxAmount={taxAmount}
                adjustmentInput={adjustmentInput}
                onAdjustmentChange={setAdjustmentInput}
                adjustmentAmount={adjustmentAmount}
                total={total}
                validationMessage={financeValidationMessage}
              />

              <div className="flex justify-end">
                <Button
                  data-testid="create-po"
                  type="submit"
                  disabled={saving || Boolean(financeValidationMessage)}
                  className="h-11 rounded-[10px] border-0 bg-[linear-gradient(135deg,#22C55E,#16A34A)] px-6 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(34,197,94,0.3)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(34,197,94,0.42)] disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Create PO"}
                </Button>
              </div>
            </div>
          </div>
        </form>
      ) : (
        <p className="text-sm text-[#9ca3af]">
          You do not have permission to create purchase orders.
        </p>
      )}

      <Card className="rounded-[12px] border border-white/10 bg-[linear-gradient(180deg,#111827,#0f172a)] shadow-[0_10px_30px_rgba(0,0,0,0.4)]">
        <CardHeader className="border-b border-white/10 px-5 py-4">
          <CardTitle className="text-[#f9fafb]">Purchase Orders</CardTitle>
        </CardHeader>
        <CardContent className="px-5 py-4">
          {loading ? (
            <p className="text-sm text-[#9ca3af]">
              Loading purchase orders...
            </p>
          ) : (
            <Table className="overflow-hidden rounded-[10px]">
              <TableHeader className="bg-[#0f172a]">
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="px-4 text-[12px] uppercase tracking-[0.08em] text-[#9ca3af]">PO No</TableHead>
                  <TableHead className="px-4 text-[12px] uppercase tracking-[0.08em] text-[#9ca3af]">Status</TableHead>
                  <TableHead className="px-4 text-[12px] uppercase tracking-[0.08em] text-[#9ca3af]">Supplier</TableHead>
                  <TableHead className="px-4 text-[12px] uppercase tracking-[0.08em] text-[#9ca3af]">Warehouse</TableHead>
                  <TableHead className="px-4 text-[12px] uppercase tracking-[0.08em] text-[#9ca3af]">Lines</TableHead>
                  <TableHead className="px-4 text-right text-[12px] uppercase tracking-[0.08em] text-[#9ca3af]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:nth-child(even)]:bg-white/[0.02]">
                {purchaseOrders.map((po) => {
                  const supplierName =
                    suppliers.find((party) => party.id === po.supplier_id)
                      ?.name ?? po.supplier_id;
                  const warehouseName =
                    warehouses.find(
                      (warehouse) => warehouse.id === po.warehouse_id,
                    )?.name ?? po.warehouse_id;

                  return (
                    <TableRow
                      key={po.id}
                      data-testid="po-row"
                      className="border-white/10 text-[#f9fafb] hover:bg-[#22C55E]/10"
                    >
                      <TableCell className="px-4 py-3" data-testid="po-number">
                        {po.po_number}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <span data-testid="status-badge">{po.status}</span>
                      </TableCell>
                      <TableCell className="px-4 py-3">{supplierName}</TableCell>
                      <TableCell className="px-4 py-3">{warehouseName}</TableCell>
                      <TableCell className="px-4 py-3">{po.lines.length}</TableCell>
                      <TableCell className="px-4 py-3 text-right">
                        {po.status === "DRAFT" && hasPermission("purchase:approve") ? (
                          <Button
                            data-testid="approve-po"
                            size="sm"
                            className="h-9 rounded-[8px] border-0 bg-[linear-gradient(135deg,#22C55E,#16A34A)] px-4 text-white transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(34,197,94,0.35)]"
                            onClick={() => handleApprove(po.id)}
                          >
                            Approve
                          </Button>
                        ) : "-"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
