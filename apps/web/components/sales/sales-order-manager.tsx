"use client";

import { useEffect, useMemo, useState } from "react";

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
import { SalesOrderStatusBadge } from "@/components/sales/status-badge";
import { Button } from "@/components/ui/button";
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
  type Party,
  type Product,
  type SalesOrder,
  type SalesOrderPayload,
  type StockAvailability,
  type Warehouse,
} from "@/lib/api/client";
import { formatQuantity } from "@/lib/quantity";

type SalesOrderLineDraft = {
  id: string;
  productId: string;
  orderedQty: string;
  unitPrice: string;
  discountPercent: string;
  gstRate: string;
  hsnCode: string;
  remarks: string;
};

const selectClassName =
  "h-11 w-full rounded-xl border border-[hsl(var(--card-border))] bg-background px-3 text-sm text-foreground shadow-sm outline-none transition focus:border-[hsl(var(--primary-btn))] focus:ring-2 focus:ring-[hsl(var(--primary-btn))]/20";

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toFixedString(value: number, digits = 2) {
  return value.toFixed(digits);
}

function newLine(index: number): SalesOrderLineDraft {
  return {
    id: `sales-line-${index}`,
    productId: "",
    orderedQty: "",
    unitPrice: "",
    discountPercent: "0",
    gstRate: "0",
    hsnCode: "",
    remarks: "",
  };
}

export function SalesOrderManager() {
  const { user, hasPermission } = usePermissions();
  const canView = !!user && (user.is_superuser || hasPermission("sales:view"));
  const canCreate = !!user && (user.is_superuser || hasPermission("sales:create"));
  const canConfirm = !!user && (user.is_superuser || hasPermission("sales:confirm"));
  const canCancel = !!user && (user.is_superuser || hasPermission("sales:cancel"));

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [historyTarget, setHistoryTarget] = useState<number | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDispatchDate, setExpectedDispatchDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [discountPercent, setDiscountPercent] = useState("0");
  const [taxPercent, setTaxPercent] = useState("0");
  const [adjustment, setAdjustment] = useState("0");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [lines, setLines] = useState<SalesOrderLineDraft[]>([newLine(1)]);
  const [availabilityByProduct, setAvailabilityByProduct] = useState<Record<string, StockAvailability>>({});
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  const customerNameById = useMemo(
    () => customers.reduce<Record<number, string>>((acc, item) => ({ ...acc, [item.id]: item.name }), {}),
    [customers],
  );
  const warehouseNameById = useMemo(
    () => warehouses.reduce<Record<number, string>>((acc, item) => ({ ...acc, [item.id]: item.name }), {}),
    [warehouses],
  );
  const productById = useMemo(
    () => products.reduce<Record<number, Product>>((acc, item) => ({ ...acc, [item.id]: item }), {}),
    [products],
  );

  const lineRequestByProduct = useMemo(() => {
    return lines.reduce<Record<string, number>>((acc, line) => {
      if (!line.productId) {
        return acc;
      }
      acc[line.productId] = (acc[line.productId] ?? 0) + toNumber(line.orderedQty);
      return acc;
    }, {});
  }, [lines]);

  const lineSummaries = useMemo(() => {
    return lines.map((line) => {
      const qty = toNumber(line.orderedQty);
      const unitPrice = toNumber(line.unitPrice);
      const discount = toNumber(line.discountPercent);
      const gross = qty * unitPrice;
      const lineDiscount = (gross * discount) / 100;
      const total = gross - lineDiscount;
      return {
        lineId: line.id,
        gross,
        total,
      };
    });
  }, [lines]);

  const subtotal = useMemo(
    () => lineSummaries.reduce((acc, line) => acc + line.total, 0),
    [lineSummaries],
  );
  const discountAmount = useMemo(
    () => (subtotal * toNumber(discountPercent)) / 100,
    [discountPercent, subtotal],
  );
  const taxAmount = useMemo(
    () => ((subtotal - discountAmount) * toNumber(taxPercent)) / 100,
    [discountAmount, subtotal, taxPercent],
  );
  const total = useMemo(
    () => subtotal - discountAmount + taxAmount + toNumber(adjustment),
    [adjustment, discountAmount, subtotal, taxAmount],
  );

  const filteredOrders = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter !== "ALL" && order.status !== statusFilter) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      return (
        order.so_number.toLowerCase().includes(normalizedSearch) ||
        (customerNameById[order.customer_id] ?? "").toLowerCase().includes(normalizedSearch) ||
        (warehouseNameById[order.warehouse_id] ?? "").toLowerCase().includes(normalizedSearch)
      );
    });
  }, [customerNameById, orders, search, statusFilter, warehouseNameById]);

  const uniqueProductIds = useMemo(
    () => [...new Set(lines.map((line) => line.productId).filter(Boolean))],
    [lines],
  );

  async function load() {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [orderResponse, customerResponse, warehouseResponse, productResponse] = await Promise.all([
        apiClient.listSalesOrders(),
        apiClient.listParties(),
        apiClient.listWarehouses(),
        apiClient.listProducts(),
      ]);
      setOrders(orderResponse.items);
      setCustomers(customerResponse);
      setWarehouses(warehouseResponse);
      setProducts(productResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load sales order data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [canView]);

  useEffect(() => {
    if (!warehouseId || uniqueProductIds.length === 0) {
      setAvailabilityByProduct({});
      return;
    }
    let cancelled = false;
    async function loadAvailability() {
      setAvailabilityLoading(true);
      try {
        const responses = await Promise.all(
          uniqueProductIds.map(async (productId) => {
            const availability = await apiClient.getStockAvailability(Number(warehouseId), Number(productId));
            return [productId, availability] as const;
          }),
        );
        if (!cancelled) {
          setAvailabilityByProduct(Object.fromEntries(responses));
        }
      } catch {
        if (!cancelled) {
          setAvailabilityByProduct({});
        }
      } finally {
        if (!cancelled) {
          setAvailabilityLoading(false);
        }
      }
    }
    void loadAvailability();
    return () => {
      cancelled = true;
    };
  }, [uniqueProductIds, warehouseId]);

  function resetForm() {
    setEditingOrderId(null);
    setCustomerId("");
    setWarehouseId("");
    setOrderDate(new Date().toISOString().slice(0, 10));
    setExpectedDispatchDate("");
    setRemarks("");
    setDiscountPercent("0");
    setTaxPercent("0");
    setAdjustment("0");
    setLines([newLine(1)]);
    setAvailabilityByProduct({});
    setResult(null);
  }

  function updateLine(lineId: string, patch: Partial<SalesOrderLineDraft>) {
    setLines((current) =>
      current.map((line) => {
        if (line.id !== lineId) {
          return line;
        }
        const next = { ...line, ...patch };
        if (patch.productId) {
          const product = productById[Number(patch.productId)];
          next.gstRate = product?.gst_rate ?? next.gstRate;
          next.hsnCode = product?.hsn ?? next.hsnCode;
        }
        return next;
      }),
    );
  }

  function addLine() {
    setLines((current) => [...current, newLine(current.length + 1)]);
  }

  function removeLine(lineId: string) {
    setLines((current) => (current.length === 1 ? [newLine(1)] : current.filter((line) => line.id !== lineId)));
  }

  function loadOrderForEdit(order: SalesOrder) {
    setEditingOrderId(order.id);
    setCustomerId(String(order.customer_id));
    setWarehouseId(String(order.warehouse_id));
    setOrderDate(order.order_date);
    setExpectedDispatchDate(order.expected_dispatch_date ?? "");
    setRemarks(order.remarks ?? "");
    setDiscountPercent(order.discount_percent);
    setTaxPercent(order.tax_percent);
    setAdjustment(order.adjustment);
    setLines(
      order.lines.map((line, index) => ({
        id: `sales-line-${index + 1}`,
        productId: String(line.product_id),
        orderedQty: line.ordered_qty,
        unitPrice: line.unit_price,
        discountPercent: line.discount_percent,
        gstRate: line.gst_rate,
        hsnCode: line.hsn_code ?? "",
        remarks: line.remarks ?? "",
      })),
    );
    setResult(null);
  }

  async function saveDraft() {
    if (!canCreate) {
      setResult({ ok: false, message: "You do not have permission to save sales orders." });
      return;
    }
    if (!customerId || !warehouseId) {
      setResult({ ok: false, message: "Customer and warehouse are required." });
      return;
    }
    const validLines = lines.filter((line) => line.productId && toNumber(line.orderedQty) > 0);
    if (validLines.length === 0) {
      setResult({ ok: false, message: "Add at least one sales order line." });
      return;
    }

    for (const [productId, requestedQty] of Object.entries(lineRequestByProduct)) {
      const availableQty = toNumber(availabilityByProduct[productId]?.available_qty);
      if (availableQty > 0 && requestedQty > availableQty) {
        const product = productById[Number(productId)];
        setResult({
          ok: false,
          message: `${product?.name ?? "Selected product"} exceeds available stock (${availableQty}).`,
        });
        return;
      }
    }

    const payload: SalesOrderPayload = {
      customer_id: Number(customerId),
      warehouse_id: Number(warehouseId),
      order_date: orderDate,
      expected_dispatch_date: expectedDispatchDate || undefined,
      remarks: remarks.trim() || undefined,
      discount_percent: toFixedString(toNumber(discountPercent)),
      discount_amount: toFixedString(discountAmount),
      tax_type: "GST",
      tax_percent: toFixedString(toNumber(taxPercent)),
      tax_amount: toFixedString(taxAmount),
      adjustment: toFixedString(toNumber(adjustment)),
      subtotal: toFixedString(subtotal),
      total: toFixedString(total),
      lines: validLines.map((line) => ({
        product_id: Number(line.productId),
        ordered_qty: line.orderedQty,
        unit_price: line.unitPrice || "0",
        discount_percent: line.discountPercent || "0",
        gst_rate: line.gstRate || "0",
        hsn_code: line.hsnCode || undefined,
        remarks: line.remarks.trim() || undefined,
      })),
    };

    setSaving(true);
    setResult(null);
    try {
      const response = editingOrderId
        ? await apiClient.updateSalesOrder(editingOrderId, payload)
        : await apiClient.createSalesOrder(payload);
      setResult({
        ok: true,
        message: `${editingOrderId ? "Updated" : "Created"} sales order ${response.so_number}.`,
      });
      setEditingOrderId(response.id);
      await load();
    } catch (caught) {
      setResult({
        ok: false,
        message: caught instanceof Error ? caught.message : "Failed to save sales order.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function confirmOrder(orderId: number) {
    if (!canConfirm) {
      setResult({ ok: false, message: "You do not have permission to confirm sales orders." });
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      const response = await apiClient.confirmSalesOrder(orderId);
      setResult({ ok: true, message: `Sales order ${response.so_number} confirmed and stock reserved.` });
      await load();
      if (editingOrderId === orderId) {
        setEditingOrderId(response.id);
      }
    } catch (caught) {
      setResult({
        ok: false,
        message: caught instanceof Error ? caught.message : "Failed to confirm sales order.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function cancelOrder(orderId: number) {
    if (!canCancel) {
      setResult({ ok: false, message: "You do not have permission to cancel sales orders." });
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      const response = await apiClient.cancelSalesOrder(orderId);
      setResult({ ok: true, message: `Sales order ${response.so_number} cancelled and reservations released.` });
      await load();
      if (editingOrderId === orderId) {
        resetForm();
      }
    } catch (caught) {
      setResult({
        ok: false,
        message: caught instanceof Error ? caught.message : "Failed to cancel sales order.",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return (
      <div className="space-y-4">
        <PageTitle title="Sales Orders" description="Create draft orders and reserve stock on confirmation." />
        <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground shadow-sm">
          You do not have permission to view sales orders.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Sales Orders"
        description="Reserve stock on order confirmation and keep physical stock untouched until dispatch posting."
      />

      <AppSectionCard
        title={editingOrderId ? "Edit Sales Order Draft" : "Sales Order Entry"}
        description="Draft customer orders, review reservation-aware stock availability, and save for later confirmation."
      >
        <AppFormGrid className="md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1">
            <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Customer</span>
            <select
              data-testid="sales-order-customer"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              className={selectClassName}
            >
              <option value="">Select customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Warehouse</span>
            <select
              data-testid="sales-order-warehouse"
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
              className={selectClassName}
            >
              <option value="">Select warehouse</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Order Date</span>
            <Input type="date" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Expected Dispatch</span>
            <Input
              type="date"
              value={expectedDispatchDate}
              onChange={(event) => setExpectedDispatchDate(event.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Order Discount %</span>
            <Input value={discountPercent} onChange={(event) => setDiscountPercent(event.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Tax %</span>
            <Input value={taxPercent} onChange={(event) => setTaxPercent(event.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Adjustment</span>
            <Input value={adjustment} onChange={(event) => setAdjustment(event.target.value)} />
          </label>
          <label className="space-y-1 md:col-span-2 xl:col-span-1">
            <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Remarks</span>
            <Input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Optional remarks" />
          </label>
        </AppFormGrid>

        <AppTable
          title="Line Items"
          description="Ordered quantities validate against available stock, where available = on hand - reserved."
          actions={
            <Button type="button" variant="outline" onClick={addLine}>
              Add Line
            </Button>
          }
          className="border-none shadow-none"
        >
          <Table className="min-w-[1280px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[260px]">Item</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead className="w-[120px] text-right">Ordered Qty</TableHead>
                <TableHead className="w-[120px] text-right">Unit Price</TableHead>
                <TableHead className="w-[120px] text-right">Discount %</TableHead>
                <TableHead className="w-[120px] text-right">GST %</TableHead>
                <TableHead className="w-[160px]">HSN</TableHead>
                <TableHead className="w-[180px] text-right">Total</TableHead>
                <TableHead className="w-[120px] text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => {
                const availability = line.productId ? availabilityByProduct[line.productId] : undefined;
                const product = productById[Number(line.productId)];
                const precision = product?.quantity_precision ?? 2;
                const requestedQty = line.productId ? lineRequestByProduct[line.productId] ?? 0 : 0;
                const availableQty = toNumber(availability?.available_qty);
                const lineTotal = lineSummaries.find((item) => item.lineId === line.id)?.total ?? 0;
                const exceedsAvailable = !!line.productId && availableQty > 0 && requestedQty > availableQty;

                return (
                  <TableRow key={line.id}>
                    <TableCell>
                      <select
                        data-testid={`sales-order-line-product-${index}`}
                        value={line.productId}
                        onChange={(event) => updateLine(line.id, { productId: event.target.value })}
                        className={selectClassName}
                      >
                        <option value="">Select product</option>
                        {products.map((productOption) => (
                          <option key={productOption.id} value={productOption.id}>
                            {productOption.name} ({productOption.sku})
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>
                      {line.productId && availability ? (
                        <div className="space-y-1 text-xs">
                          <div className="text-[hsl(var(--text-primary))]">
                            On Hand {formatQuantity(availability.on_hand_qty, precision)} | Reserved{" "}
                            {formatQuantity(availability.reserved_qty, precision)} | Available{" "}
                            {formatQuantity(availability.available_qty, precision)}
                          </div>
                          <div className={exceedsAvailable ? "text-rose-600" : "text-[hsl(var(--text-secondary))]"}>
                            Requested across draft: {requestedQty.toFixed(precision)}
                          </div>
                        </div>
                      ) : availabilityLoading && line.productId ? (
                        <span className="text-xs text-muted-foreground">Loading availability...</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Select warehouse and item.</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        data-testid={`sales-order-line-qty-${index}`}
                        value={line.orderedQty}
                        onChange={(event) => updateLine(line.id, { orderedQty: event.target.value })}
                        className="text-right"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={line.unitPrice}
                        onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })}
                        className="text-right"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={line.discountPercent}
                        onChange={(event) => updateLine(line.id, { discountPercent: event.target.value })}
                        className="text-right"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={line.gstRate}
                        onChange={(event) => updateLine(line.id, { gstRate: event.target.value })}
                        className="text-right"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={line.hsnCode}
                        onChange={(event) => updateLine(line.id, { hsnCode: event.target.value })}
                      />
                    </TableCell>
                    <TableCell className="text-right font-medium text-[hsl(var(--text-primary))]">
                      {toFixedString(lineTotal)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removeLine(line.id)}
                        disabled={lines.length === 1 && index === 0}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </AppTable>

        <AppSummaryPanel className="border border-[hsl(var(--card-border))] shadow-none">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Subtotal</p>
              <p className="mt-1 text-lg font-semibold text-[hsl(var(--text-primary))]">{toFixedString(subtotal)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Discount</p>
              <p className="mt-1 text-lg font-semibold text-[hsl(var(--text-primary))]">{toFixedString(discountAmount)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Tax</p>
              <p className="mt-1 text-lg font-semibold text-[hsl(var(--text-primary))]">{toFixedString(taxAmount)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Adjustment</p>
              <p className="mt-1 text-lg font-semibold text-[hsl(var(--text-primary))]">{toFixedString(toNumber(adjustment))}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Order Total</p>
              <p className="mt-1 text-lg font-semibold text-[hsl(var(--text-primary))]">{toFixedString(total)}</p>
            </div>
          </div>
        </AppSummaryPanel>

        {result ? (
          <p
            data-testid="sales-order-result"
            className={result.ok ? "text-sm text-emerald-600" : "text-sm text-rose-600"}
          >
            {result.message}
          </p>
        ) : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        <AppActionBar>
          <Button type="button" variant="outline" onClick={resetForm}>
            {editingOrderId ? "Clear Draft" : "Reset"}
          </Button>
          <Button type="button" data-testid="sales-order-save" onClick={saveDraft} disabled={saving || !canCreate}>
            {saving ? "Saving..." : editingOrderId ? "Update Draft" : "Save Draft"}
          </Button>
          {editingOrderId ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void confirmOrder(editingOrderId)}
              disabled={saving || !canConfirm}
            >
              Confirm Draft
            </Button>
          ) : null}
        </AppActionBar>
      </AppSectionCard>

      <AppSectionCard title="Sales Orders" description="Review order status, confirmation state, and reservation-aware fulfillment progress.">
        <AppFormGrid className="md:grid-cols-3">
          <label className="space-y-1">
            <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Search</span>
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="SO number, customer, warehouse" />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={selectClassName}>
              <option value="ALL">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="PARTIALLY_DISPATCHED">Partially Dispatched</option>
              <option value="DISPATCHED">Dispatched</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>
        </AppFormGrid>

        <div className="overflow-auto rounded-xl border border-[hsl(var(--card-border))]">
          <Table className="min-w-[1100px]">
            <TableHeader>
              <TableRow>
                <TableHead>SO No</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Order Date</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    Loading sales orders...
                  </TableCell>
                </TableRow>
              ) : filteredOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    No sales orders found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium text-[hsl(var(--text-primary))]">{order.so_number}</TableCell>
                    <TableCell>{customerNameById[order.customer_id] ?? `Customer #${order.customer_id}`}</TableCell>
                    <TableCell>{warehouseNameById[order.warehouse_id] ?? `Warehouse #${order.warehouse_id}`}</TableCell>
                    <TableCell><SalesOrderStatusBadge status={order.status} /></TableCell>
                    <TableCell>{order.order_date}</TableCell>
                    <TableCell className="text-right">{order.lines.length}</TableCell>
                    <TableCell className="text-right">{order.total}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {order.status === "DRAFT" ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => loadOrderForEdit(order)} disabled={!canCreate}>
                            Edit
                          </Button>
                        ) : null}
                        {order.status === "DRAFT" ? (
                          <Button type="button" size="sm" onClick={() => void confirmOrder(order.id)} disabled={!canConfirm}>
                            Confirm
                          </Button>
                        ) : null}
                        {order.status !== "DISPATCHED" && order.status !== "CANCELLED" ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => void cancelOrder(order.id)} disabled={!canCancel}>
                            Cancel
                          </Button>
                        ) : null}
                        <Button type="button" variant="outline" size="sm" onClick={() => setHistoryTarget(order.id)}>
                          History
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </AppSectionCard>

      <RecordHistoryDrawer
        open={historyTarget !== null}
        onClose={() => setHistoryTarget(null)}
        entityType="SALES_ORDER"
        entityId={historyTarget}
        title="Sales Order History"
      />
    </div>
  );
}
