"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { usePermissions } from "@/components/auth/permission-provider";
import {
  AppActionBar,
  AppFormGrid,
  AppPageHeader,
  AppSectionCard,
  AppSummaryPanel,
} from "@/components/erp/app-primitives";
import { PurchaseOrderStatusBadge } from "@/components/purchase/purchase-order-status-badge";
import { PurchaseLineDraft } from "@/components/purchase/purchase-line-row";
import {
  PurchaseLineFinancials,
  PurchaseLineGrid,
} from "@/components/purchase/purchase-line-grid";
import { PurchaseOrderSummary } from "@/components/purchase/purchase-order-summary";
import { Button } from "@/components/ui/button";
import { ErpCombobox } from "@/components/ui/erp-combobox";
import { Input } from "@/components/ui/input";
import {
  apiClient,
  CompanySettings,
  Party,
  Product,
  PurchaseOrder,
  PurchaseOrderLinePayload,
  Warehouse,
} from "@/lib/api/client";
import { extractStateFromGstin, GSTIN_PATTERN, normalizeGstin } from "@/lib/gst";
import { formatQuantity } from "@/lib/quantity";

type LineAction =
  | { type: "update"; lineId: string; patch: Partial<PurchaseLineDraft> }
  | { type: "add"; line: PurchaseLineDraft; afterLineId?: string }
  | { type: "remove"; lineId: string }
  | { type: "replace_all"; lines: PurchaseLineDraft[] }
  | { type: "reset"; line: PurchaseLineDraft };

type PurchaseTaxMode = "INTRA_STATE" | "INTER_STATE" | "UNDETERMINED";

type PurchaseOrderManagerProps = {
  mode: "create" | "edit";
  purchaseOrderId?: number;
};

const amountFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseDecimalInput(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") {
    return 0;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPercentDisplay(value: number) {
  return `${value.toFixed(2)}%`;
}

function getValidGstin(value: string | null | undefined): string | null {
  const normalized = normalizeGstin(value ?? "");
  return GSTIN_PATTERN.test(normalized) ? normalized : null;
}

function lineReducer(state: PurchaseLineDraft[], action: LineAction) {
  switch (action.type) {
    case "update":
      return state.map((line) => (line.id === action.lineId ? { ...line, ...action.patch } : line));
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
    case "replace_all":
      return action.lines;
    case "reset":
      return [action.line];
    default:
      return state;
  }
}

export function PurchaseOrderManager({ mode, purchaseOrderId }: PurchaseOrderManagerProps) {
  const router = useRouter();
  const { user, hasPermission, loading: permissionLoading } = usePermissions();
  const canCreate = !!user && (user.is_superuser || hasPermission("purchase:create"));
  const canUpdate = !!user && (user.is_superuser || hasPermission("purchase:update"));
  const canApprove = !!user && (user.is_superuser || hasPermission("purchase:approve"));
  const canCancel = !!user && (user.is_superuser || hasPermission("purchase:cancel"));

  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [currentPo, setCurrentPo] = useState<PurchaseOrder | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [discountPercentInput, setDiscountPercentInput] = useState("0");
  const [adjustmentInput, setAdjustmentInput] = useState("0");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
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

  const [lines, dispatch] = useReducer(lineReducer, undefined, () => [createEmptyLine()]);

  const hydrateDraftFromPo = useCallback(
    (po: PurchaseOrder, productList: Product[]) => {
      const productsById = new Map(productList.map((product) => [product.id, product] as const));
      setCurrentPo(po);
      setSupplierId(String(po.supplier_id));
      setWarehouseId(String(po.warehouse_id));
      setDiscountPercentInput(po.discount_percent);
      setAdjustmentInput(po.adjustment);
      setOrderDate(po.order_date);
      const mappedLines = po.lines.map((line) => {
        const product = productsById.get(line.product_id);
        const productName = line.product_name || product?.name || `Product #${line.product_id}`;
        const gstValue = Number.parseFloat(product?.gst_rate ?? line.gst_percent ?? "0");
        const suffix = Number.isFinite(gstValue) ? ` (${gstValue.toFixed(0)}%)` : "";
        return createEmptyLine({
          product_id: String(line.product_id),
          product_query: `${productName}${suffix}`,
          batch: "",
          expiry: "",
          ordered_qty: line.ordered_qty,
          unit_cost: line.unit_cost ?? "",
          free_qty: line.free_qty,
        });
      });
      dispatch({ type: "replace_all", lines: mappedLines.length > 0 ? mappedLines : [createEmptyLine()] });
    },
    [createEmptyLine],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const requests = [
        apiClient.listParties(),
        apiClient.listWarehouses(),
        apiClient.listProducts(),
        apiClient.getCompanySettings().catch(() => null),
      ] as const;
      const [parties, warehouseRes, productRes, companySettingsRes] = await Promise.all(requests);
      setSuppliers(parties.filter((party) => party.party_type === "SUPPLIER" || party.party_type === "BOTH"));
      setWarehouses(warehouseRes);
      setProducts(productRes);
      setCompanySettings(companySettingsRes);

      if (mode === "edit" && purchaseOrderId) {
        const po = await apiClient.getPurchaseOrder(purchaseOrderId);
        hydrateDraftFromPo(po, productRes);
      } else {
        setCurrentPo(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load purchase order form");
    } finally {
      setLoading(false);
    }
  }, [hydrateDraftFromPo, mode, purchaseOrderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateLine = useCallback((lineId: string, patch: Partial<PurchaseLineDraft>) => {
    dispatch({ type: "update", lineId, patch });
  }, []);

  const addLine = useCallback(() => {
    const line = createEmptyLine();
    dispatch({ type: "add", line });
    return line.id;
  }, [createEmptyLine]);

  const duplicateLine = useCallback(
    (source: PurchaseLineDraft) => {
      const line = createEmptyLine({
        product_id: source.product_id,
        product_query: source.product_query,
        batch: source.batch,
        expiry: source.expiry,
        ordered_qty: source.ordered_qty,
        unit_cost: source.unit_cost,
        free_qty: source.free_qty,
      });
      dispatch({ type: "add", line, afterLineId: source.id });
      return line.id;
    },
    [createEmptyLine],
  );

  const removeLine = useCallback((lineId: string) => {
    dispatch({ type: "remove", lineId });
  }, []);

  const selectedSupplier = useMemo(
    () => suppliers.find((supplier) => String(supplier.id) === supplierId) ?? null,
    [supplierId, suppliers],
  );
  const productsById = useMemo(
    () => new Map(products.map((product) => [String(product.id), product] as const)),
    [products],
  );

  const rawDiscountPercent = parseDecimalInput(discountPercentInput);
  const discountPercent = Math.min(Math.max(rawDiscountPercent, 0), 100);
  const adjustmentAmount = roundCurrency(parseDecimalInput(adjustmentInput));
  const supplierGstin = getValidGstin(selectedSupplier?.gstin ?? null);
  const supplierState =
    (supplierGstin ? extractStateFromGstin(supplierGstin) : selectedSupplier?.state?.trim()) || null;
  const companyGstin = getValidGstin(companySettings?.gst_number ?? null);
  const companyState =
    (companyGstin ? extractStateFromGstin(companyGstin) : companySettings?.state?.trim()) || null;

  let taxMode: PurchaseTaxMode = "UNDETERMINED";
  if (supplierState && companyState) {
    taxMode = supplierState === companyState ? "INTRA_STATE" : "INTER_STATE";
  }

  const lineFinancials = useMemo(
    () =>
      lines.map((line) => {
        const quantity = Number.parseFloat(line.ordered_qty || "0");
        const unitCost = Number.parseFloat(line.unit_cost || "0");
        const normalizedQuantity = Number.isFinite(quantity) ? quantity : 0;
        const normalizedUnitCost = Number.isFinite(unitCost) ? unitCost : 0;
        const lineSubtotal = roundCurrency(normalizedQuantity * normalizedUnitCost);
        const lineDiscountAmount = roundCurrency((lineSubtotal * discountPercent) / 100);
        const lineTaxableValue = roundCurrency(Math.max(lineSubtotal - lineDiscountAmount, 0));
        const matchedProduct = productsById.get(line.product_id);
        const productRate = Number.parseFloat(matchedProduct?.gst_rate ?? "0");
        const effectiveGstPercent = Number.isFinite(productRate) && productRate > 0 ? productRate : 0;
        const lineCgstPercent = taxMode === "INTRA_STATE" ? roundCurrency(effectiveGstPercent / 2) : 0;
        const lineSgstPercent = lineCgstPercent;
        const lineIgstPercent = taxMode === "INTER_STATE" ? roundCurrency(effectiveGstPercent) : 0;
        const lineCgstAmount = roundCurrency((lineTaxableValue * lineCgstPercent) / 100);
        const lineSgstAmount = roundCurrency((lineTaxableValue * lineSgstPercent) / 100);
        const lineIgstAmount = roundCurrency((lineTaxableValue * lineIgstPercent) / 100);
        const fallbackTaxAmount = roundCurrency((lineTaxableValue * effectiveGstPercent) / 100);
        const lineTaxAmount =
          taxMode === "UNDETERMINED"
            ? fallbackTaxAmount
            : roundCurrency(lineCgstAmount + lineSgstAmount + lineIgstAmount);
        return {
          lineId: line.id,
          subtotal: lineSubtotal,
          discountAmount: lineDiscountAmount,
          taxableValue: lineTaxableValue,
          gstPercent: effectiveGstPercent,
          cgstPercent: lineCgstPercent,
          sgstPercent: lineSgstPercent,
          igstPercent: lineIgstPercent,
          cgstAmount: lineCgstAmount,
          sgstAmount: lineSgstAmount,
          igstAmount: lineIgstAmount,
          taxAmount: lineTaxAmount,
          lineTotal: roundCurrency(lineTaxableValue + lineTaxAmount),
        };
      }),
    [discountPercent, lines, productsById, taxMode],
  );

  const lineFinancialsById = useMemo<Record<string, PurchaseLineFinancials>>(
    () =>
      Object.fromEntries(
        lineFinancials.map((line) => [
          line.lineId,
          {
            gstDisplay: formatPercentDisplay(line.gstPercent),
            taxAmount: line.taxAmount,
            lineTotal: line.lineTotal,
          },
        ]),
      ),
    [lineFinancials],
  );

  const subtotal = roundCurrency(lineFinancials.reduce((sum, line) => sum + line.subtotal, 0));
  const discountAmount = roundCurrency(lineFinancials.reduce((sum, line) => sum + line.discountAmount, 0));
  const taxableAmount = roundCurrency(lineFinancials.reduce((sum, line) => sum + line.taxableValue, 0));
  const cgstAmount = roundCurrency(lineFinancials.reduce((sum, line) => sum + line.cgstAmount, 0));
  const sgstAmount = roundCurrency(lineFinancials.reduce((sum, line) => sum + line.sgstAmount, 0));
  const igstAmount = roundCurrency(lineFinancials.reduce((sum, line) => sum + line.igstAmount, 0));
  const totalTaxAmount = roundCurrency(cgstAmount + sgstAmount + igstAmount);
  const total = Math.max(roundCurrency(taxableAmount + totalTaxAmount + adjustmentAmount), 0);
  const totalQuantity = lines.reduce((sum, line) => sum + parseDecimalInput(line.ordered_qty || "0"), 0);
  const totalQuantityDisplay = formatQuantity(totalQuantity, Number.isInteger(totalQuantity) ? 0 : 3);

  const orderHasTax = lineFinancials.some((line) => line.gstPercent > 0);
  const financeValidationMessage = useMemo(() => {
    if (rawDiscountPercent < 0 || rawDiscountPercent > 100) {
      return "Discount must be between 0% and 100%.";
    }
    if (orderHasTax && !companyGstin) {
      return "Company GSTIN not configured. Cannot determine CGST/SGST/IGST automatically.";
    }
    if (orderHasTax && supplierId && !supplierGstin) {
      return "Supplier GSTIN is required to determine CGST/SGST/IGST automatically.";
    }
    if (orderHasTax && supplierId && (!supplierState || !companyState)) {
      return "Tax context cannot be determined automatically.";
    }
    if (total < 0) {
      return "Final total cannot be negative.";
    }
    return null;
  }, [companyGstin, companyState, orderHasTax, rawDiscountPercent, supplierGstin, supplierId, supplierState, total]);

  const taxWarningMessage = useMemo(() => {
    if (!orderHasTax) {
      return null;
    }
    if (!companyGstin) {
      return "Company GSTIN not configured. Cannot determine CGST/SGST/IGST automatically.";
    }
    if (supplierId && !supplierGstin) {
      return "Supplier GSTIN is missing. Auto tax mode needs supplier GST registration to determine intra-state vs inter-state tax.";
    }
    if (supplierId && (!supplierState || !companyState)) {
      return "Tax context cannot be determined automatically.";
    }
    return null;
  }, [companyGstin, companyState, orderHasTax, supplierGstin, supplierId, supplierState]);

  const validLines = useMemo(
    () =>
      lines.filter(
        (line) =>
          line.product_id &&
          parseDecimalInput(line.ordered_qty) > 0 &&
          parseDecimalInput(line.unit_cost) >= 0,
      ),
    [lines],
  );

  const canSubmitDraft =
    Boolean(supplierId) &&
    Boolean(warehouseId) &&
    validLines.length > 0 &&
    !financeValidationMessage &&
    (mode === "create" ? canCreate : canUpdate);
  const canSubmitApproval = canSubmitDraft && canApprove;

  const buildPayload = () => {
    if (!supplierId || !warehouseId) {
      throw new Error("Supplier and warehouse are required");
    }
    if (financeValidationMessage) {
      throw new Error(financeValidationMessage);
    }
    const linePayload: PurchaseOrderLinePayload[] = validLines.map((line) => ({
      product_id: Number(line.product_id),
      ordered_qty: line.ordered_qty,
      unit_cost: line.unit_cost || undefined,
      free_qty: line.free_qty || "0",
    }));
    if (linePayload.length === 0) {
      throw new Error("Add at least one valid line item");
    }
    return {
      supplier_id: Number(supplierId),
      warehouse_id: Number(warehouseId),
      order_date: orderDate,
      discount_percent: discountPercent,
      gst_percent: 0,
      adjustment: adjustmentAmount,
      lines: linePayload,
    };
  };

  const saveDraft = async (approveAfterSave = false) => {
    if (approveAfterSave) {
      setApproving(true);
    } else {
      setSaving(true);
    }
    setError(null);

    try {
      const payload = buildPayload();
      const po =
        mode === "create"
          ? await apiClient.createPurchaseOrder(payload)
          : await apiClient.updatePurchaseOrder(purchaseOrderId!, payload);
      const finalPo = approveAfterSave ? await apiClient.approvePurchaseOrder(po.id) : po;
      router.push(`/purchase-orders/${finalPo.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save purchase order");
    } finally {
      setSaving(false);
      setApproving(false);
    }
  };

  const handleCancelDraft = async () => {
    if (!purchaseOrderId) {
      return;
    }
    setCancelling(true);
    setError(null);
    try {
      await apiClient.cancelPurchaseOrder(purchaseOrderId);
      router.push(`/purchase-orders/${purchaseOrderId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel purchase order");
    } finally {
      setCancelling(false);
    }
  };

  if (loading || permissionLoading) {
    return <p className="text-sm text-muted-foreground">Loading purchase order...</p>;
  }

  if (mode === "create" && !canCreate) {
    return <p className="text-sm text-muted-foreground">You do not have permission to create purchase orders.</p>;
  }

  if (mode === "edit" && !canUpdate) {
    return <p className="text-sm text-muted-foreground">You do not have permission to edit purchase orders.</p>;
  }

  if (mode === "edit" && currentPo && currentPo.status !== "DRAFT") {
    return (
      <div className="flex flex-col gap-6">
        <AppPageHeader
          title={currentPo.po_number}
          description="Only draft purchase orders can be edited."
          actions={
            <>
              <Button asChild variant="outline">
                <Link href="/purchase-orders">Back to List</Link>
              </Button>
              <Button asChild>
                <Link href={`/purchase-orders/${currentPo.id}`}>View Purchase Order</Link>
              </Button>
            </>
          }
        />
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          This purchase order is {currentPo.status.toLowerCase()} and cannot be edited.
        </p>
      </div>
    );
  }

  const supplierOptions = suppliers.map((supplier) => ({
    label: supplier.name,
    value: String(supplier.id),
  }));
  const warehouseOptions = warehouses.map((warehouse) => ({
    label: warehouse.name,
    value: String(warehouse.id),
  }));

  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader
        title={mode === "create" ? "New Purchase Order" : currentPo?.po_number ?? "Edit Purchase Order"}
        description={
          mode === "create"
            ? "Create a draft purchase order with supplier, warehouse, line items, and approval-ready totals."
            : `Update draft purchase order${currentPo ? ` • Last updated ${new Date(currentPo.updated_at).toLocaleString()}` : ""}.`
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={mode === "edit" && currentPo ? `/purchase-orders/${currentPo.id}` : "/purchase-orders"}>
                Back
              </Link>
            </Button>
            <Button
              data-testid={mode === "create" ? "create-po" : "update-po"}
              type="button"
              onClick={() => void saveDraft(false)}
              disabled={saving || approving || !canSubmitDraft}
            >
              {saving ? "Saving..." : mode === "create" ? "Save Draft" : "Update Draft"}
            </Button>
            <Button
              data-testid="approve-po"
              type="button"
              onClick={() => void saveDraft(true)}
              disabled={saving || approving || !canSubmitApproval}
            >
              {approving ? "Approving..." : "Approve PO"}
            </Button>
            {mode === "edit" && currentPo ? (
              <Button
                type="button"
                variant="outline"
                data-testid="cancel-po"
                onClick={() => void handleCancelDraft()}
                disabled={cancelling || saving || approving || !canCancel}
              >
                {cancelling ? "Cancelling..." : "Cancel PO"}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={addLine}>
              Add Row
            </Button>
          </>
        }
      />

      {error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <AppSectionCard
        title="Purchase Header"
        description={mode === "create" ? "Draft number will be assigned on save." : `Status-aware editing for ${currentPo?.po_number ?? "draft purchase order"}.`}
      >
        <AppFormGrid className="xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1.4fr)_180px_180px]">
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
              triggerClassName="h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-none"
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
              triggerClassName="h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-none"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
              PO Date
            </span>
            <Input type="date" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} required />
          </label>

          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
              Status
            </span>
            <div className="flex h-11 items-center rounded-xl border border-border px-3">
              <PurchaseOrderStatusBadge status={currentPo?.status ?? "DRAFT"} />
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
          lineFinancialsById={lineFinancialsById}
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
            taxableValue={taxableAmount}
            cgstPercent={taxMode === "INTRA_STATE" ? 0 : 0}
            sgstPercent={taxMode === "INTRA_STATE" ? 0 : 0}
            igstPercent={taxMode === "INTER_STATE" ? 0 : 0}
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
            <span className="mr-auto text-sm text-[hsl(var(--text-secondary))]">
              {currentPo?.created_by_name ? `Created by ${currentPo.created_by_name}` : "Draft purchase order"}
            </span>
            <Button
              data-testid={mode === "create" ? "create-po-footer" : "update-po-footer"}
              type="button"
              onClick={() => void saveDraft(false)}
              disabled={saving || approving || !canSubmitDraft}
            >
              {saving ? "Saving..." : mode === "create" ? "Save Draft" : "Update Draft"}
            </Button>
          </AppActionBar>
        </div>
      </div>
    </div>
  );
}
