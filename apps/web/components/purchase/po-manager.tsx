"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { usePermissions } from "@/components/auth/permission-provider";
import {
  AppActionBar,
  AppFormGrid,
  AppPageHeader,
  AppSectionCard,
  AppSummaryPanel,
  AppTable,
} from "@/components/erp/app-primitives";
import {
  PurchaseOrderSummary,
  type PurchaseOrderTaxOption,
} from "@/components/purchase/purchase-order-summary";
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
  PurchaseOrder,
  PurchaseOrderLinePayload,
  apiClient,
  CompanySettings,
  Party,
  Product,
  TaxRate,
  Warehouse,
} from "@/lib/api/client";
import { extractStateFromGstin, GSTIN_PATTERN, normalizeGstin } from "@/lib/gst";
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

type PurchaseTaxMode = "INTRA_STATE" | "INTER_STATE" | "UNDETERMINED";

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

function normalizeTaxLabel(label: string | null | undefined, percent: number) {
  const cleaned = (label ?? "").trim();
  const percentText = percentFormatter.format(percent);

  if (!cleaned) {
    return `GST ${percentText}%`;
  }

  return cleaned;
}

function normalizeRatePercent(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed.toFixed(2);
}

function getSuggestedTaxOptionValue(
  lines: PurchaseLineDraft[],
  products: Product[],
  taxOptions: PurchaseOrderTaxOption[],
): string {
  const productsById = new Map(
    products.map((product) => [String(product.id), product] as const),
  );
  const matchedRates = new Set<string>();

  for (const line of lines) {
    if (!line.product_id) {
      continue;
    }

    const matchedProduct = productsById.get(line.product_id);
    const normalizedRate = normalizeRatePercent(matchedProduct?.gst_rate);
    if (normalizedRate) {
      matchedRates.add(normalizedRate);
    }
  }

  if (matchedRates.size !== 1) {
    return "";
  }

  const [targetRate] = [...matchedRates];
  return (
    taxOptions.find(
      (option) => option.tax_percent.toFixed(2) === targetRate,
    )?.value ?? ""
  );
}

function getValidGstin(value: string | null | undefined): string | null {
  const normalized = normalizeGstin(value ?? "");
  return GSTIN_PATTERN.test(normalized) ? normalized : null;
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
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [discountPercentInput, setDiscountPercentInput] = useState("0");
  const [selectedTaxRateId, setSelectedTaxRateId] = useState("");
  const [taxSelectionMode, setTaxSelectionMode] = useState<"auto" | "manual">(
    "auto",
  );
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
      const [poRes, parties, warehouseRes, productRes, taxRateRes, companySettingsRes] =
        await Promise.all([
          apiClient.listPurchaseOrders(),
          apiClient.listParties(),
          apiClient.listWarehouses(),
          apiClient.listProducts(),
          apiClient.listTaxRates(),
          apiClient.getCompanySettings().catch(() => null),
        ]);
      setPurchaseOrders(poRes.items);
      setSuppliers(parties);
      setWarehouses(warehouseRes);
      setProducts(productRes);
      setTaxRates(taxRateRes);
      setCompanySettings(companySettingsRes);
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
    setSelectedTaxRateId("");
    setTaxSelectionMode("auto");
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
        discount_percent: discountPercent,
        gst_percent: gstPercent,
        adjustment: adjustmentAmount,
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

  const selectedSupplier = useMemo(
    () =>
      suppliers.find((supplier) => String(supplier.id) === supplierId) ?? null,
    [supplierId, suppliers],
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
        const label = normalizeTaxLabel(taxRate.label, normalizedTaxPercent);

        return {
          label,
          value: String(taxRate.id),
          tax_name: label,
          tax_percent: normalizedTaxPercent,
        };
      });
  }, [taxRates]);

  const selectedTaxOption = useMemo(
    () => taxOptions.find((option) => option.value === selectedTaxRateId) ?? null,
    [selectedTaxRateId, taxOptions],
  );

  useEffect(() => {
    if (taxSelectionMode !== "auto") {
      return;
    }

    const suggestedTaxOptionValue = getSuggestedTaxOptionValue(
      lines,
      products,
      taxOptions,
    );

    setSelectedTaxRateId((current) =>
      current === suggestedTaxOptionValue ? current : suggestedTaxOptionValue,
    );
  }, [lines, products, taxOptions, taxSelectionMode]);

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
  const gstPercent = selectedTaxOption?.tax_percent ?? 0;
  const rawSupplierGstin = selectedSupplier?.gstin ?? null;
  const supplierGstin = getValidGstin(rawSupplierGstin);
  const supplierState =
    (supplierGstin ? extractStateFromGstin(supplierGstin) : selectedSupplier?.state?.trim()) ||
    null;
  const rawCompanyGstin = companySettings?.gst_number ?? null;
  const companyGstin = getValidGstin(rawCompanyGstin);
  const companyState =
    (companyGstin ? extractStateFromGstin(companyGstin) : companySettings?.state?.trim()) ||
    null;
  const hasSupplierGstinValue = Boolean(normalizeGstin(rawSupplierGstin ?? ""));
  const hasCompanyGstinValue = Boolean(normalizeGstin(rawCompanyGstin ?? ""));
  let taxMode: PurchaseTaxMode = "UNDETERMINED";
  let cgstPercent = 0;
  let sgstPercent = 0;
  let igstPercent = 0;

  if (gstPercent > 0 && supplierGstin && companyGstin) {
    if (supplierState && companyState && supplierState === companyState) {
      const halfRate = roundCurrency(gstPercent / 2);
      cgstPercent = halfRate;
      sgstPercent = halfRate;
      taxMode = "INTRA_STATE";
    } else {
      igstPercent = gstPercent;
      taxMode = "INTER_STATE";
    }
  }

  const cgstAmount = roundCurrency((taxableAmount * cgstPercent) / 100);
  const sgstAmount = roundCurrency((taxableAmount * sgstPercent) / 100);
  const igstAmount = roundCurrency((taxableAmount * igstPercent) / 100);
  const adjustmentAmount = roundCurrency(parseDecimalInput(adjustmentInput));
  const rawTotal = roundCurrency(
    taxableAmount + cgstAmount + sgstAmount + igstAmount + adjustmentAmount,
  );
  const total = Math.max(rawTotal, 0);

  const taxWarningMessage = useMemo(() => {
    if (!hasCompanyGstinValue) {
      return "Company GSTIN not configured. Cannot determine CGST/SGST/IGST automatically.";
    }

    if (!companyGstin) {
      return "Company GSTIN is invalid. Fix organization GST settings before creating GST-bearing purchase orders.";
    }

    if (supplierId && !hasSupplierGstinValue) {
      return "Supplier GSTIN is missing. Auto tax mode needs supplier GST registration to determine intra-state vs inter-state tax.";
    }

    if (supplierId && !supplierGstin) {
      return "Supplier GSTIN is invalid. Fix the supplier master before creating GST-bearing purchase orders.";
    }

    return null;
  }, [
    companyGstin,
    hasCompanyGstinValue,
    hasSupplierGstinValue,
    supplierGstin,
    supplierId,
  ]);

  const financeValidationMessage = useMemo(() => {
    if (rawDiscountPercent < 0 || rawDiscountPercent > 100) {
      return "Discount must be between 0% and 100%.";
    }

    if (gstPercent > 0 && !companyGstin) {
      return "Company GSTIN not configured. Cannot determine CGST/SGST/IGST automatically.";
    }

    if (gstPercent > 0 && supplierId && !supplierGstin) {
      return "Supplier GSTIN is required to determine CGST/SGST/IGST automatically.";
    }

    if (rawTotal < 0) {
      return "Final total cannot be negative.";
    }

    return null;
  }, [companyGstin, gstPercent, rawDiscountPercent, rawTotal, supplierGstin, supplierId]);

  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader
        title="Purchase Orders"
        description="Create purchase orders, maintain line items, and track approval-ready drafts in one consistent ERP workspace."
      />
      {error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </p>
      ) : null}
      {permissionLoading ? (
        <p className="text-sm text-muted-foreground">Loading permissions...</p>
      ) : hasPermission("purchase:create") ? (
        <form className="flex flex-col gap-6" onSubmit={handleCreatePo}>
          <AppSectionCard
            title="Purchase Header"
            description="Select the supplier, warehouse, and posting date before entering line items."
            actions={
              <Button type="button" onClick={addLine}>
                Add Row
              </Button>
            }
          >
            <AppFormGrid className="xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1.4fr)_180px_120px]">
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
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
                      triggerClassName="h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-none focus-visible:border-primary/40 focus-visible:ring-primary/20"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
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
                      triggerClassName="h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-none focus-visible:border-primary/40 focus-visible:ring-primary/20"
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
                      PO Date
                    </span>
                    <Input
                      type="date"
                      value={orderDate}
                      onChange={(event) => setOrderDate(event.target.value)}
                      required
                    />
                  </label>

                  <div className="space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
                      Status
                    </span>
                    <div className="flex h-11 items-center rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                      DRAFT
                    </div>
                  </div>
            </AppFormGrid>
          </AppSectionCard>

          <AppSectionCard
            title="Line Items"
            description="Use the ERP entry grid for item-level quantity and cost entry. Enter on Unit Cost adds the next row."
          >
            <PurchaseLineGrid
              rows={lines}
              products={products}
              onUpdateLine={updateLine}
              onAddLine={addLine}
              onRemoveLine={removeLine}
              onDuplicateLine={duplicateLine}
              formatAmount={(value) => amountFormatter.format(value)}
            />
          </AppSectionCard>

          <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
            <AppSummaryPanel className="h-fit">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
                Total Qty
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-[hsl(var(--text-primary))]">
                {totalQuantityDisplay}
              </p>
            </AppSummaryPanel>

            <div className="flex flex-col gap-4 xl:ml-auto xl:max-w-[520px]">
              <PurchaseOrderSummary
                subtotal={subtotal}
                discountPercentInput={discountPercentInput}
                onDiscountPercentChange={setDiscountPercentInput}
                discountAmount={discountAmount}
                taxOptions={taxOptions}
                selectedTaxRateId={selectedTaxRateId}
                onSelectedTaxRateIdChange={(value) => {
                  setTaxSelectionMode("manual");
                  setSelectedTaxRateId(value);
                }}
                gstPercent={gstPercent}
                taxableValue={taxableAmount}
                taxMode={taxMode}
                supplierGstin={supplierGstin}
                supplierState={supplierState}
                companyGstin={companyGstin}
                companyState={companyState}
                cgstPercent={cgstPercent}
                sgstPercent={sgstPercent}
                igstPercent={igstPercent}
                cgstAmount={cgstAmount}
                sgstAmount={sgstAmount}
                igstAmount={igstAmount}
                adjustmentInput={adjustmentInput}
                onAdjustmentChange={setAdjustmentInput}
                adjustmentAmount={adjustmentAmount}
                total={total}
                warningMessage={taxWarningMessage}
                validationMessage={financeValidationMessage}
              />
              <AppActionBar>
                <Button
                  data-testid="create-po"
                  type="submit"
                  disabled={saving || Boolean(financeValidationMessage)}
                  className="px-6"
                >
                  {saving ? "Saving..." : "Create PO"}
                </Button>
              </AppActionBar>
            </div>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          You do not have permission to create purchase orders.
        </p>
      )}

      <AppTable title="Purchase Orders" description="Review existing purchase orders and approve draft records.">
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">
              Loading purchase orders...
            </p>
          ) : (
            <Table>
              <TableHeader className="bg-[hsl(var(--table-header-bg))]">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-4">PO No</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4">Supplier</TableHead>
                  <TableHead className="px-4">Warehouse</TableHead>
                  <TableHead className="px-4">Lines</TableHead>
                  <TableHead className="px-4 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
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
                      className="[&:nth-child(even)]:bg-[hsl(var(--muted-bg))]/60"
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
      </AppTable>
    </div>
  );
}
