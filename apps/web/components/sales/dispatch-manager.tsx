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
import {
  DispatchStatusBadge,
  ReservationStatusBadge,
  SalesOrderStatusBadge,
} from "@/components/sales/status-badge";
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
  type DispatchNote,
  type Party,
  type Product,
  type SalesOrder,
  type StockAvailability,
  type StockReservation,
  type Warehouse,
} from "@/lib/api/client";
import { formatQuantity } from "@/lib/quantity";

type AllocationDraft = {
  id: string;
  batchId: string;
  qty: string;
};

const selectClassName =
  "h-11 w-full rounded-xl border border-[hsl(var(--card-border))] bg-background px-3 text-sm text-foreground shadow-sm outline-none transition focus:border-[hsl(var(--primary-btn))] focus:ring-2 focus:ring-[hsl(var(--primary-btn))]/20";

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nextAllocationId(lineId: number, index: number) {
  return `allocation-${lineId}-${index}`;
}

export function DispatchManager() {
  const { user, hasPermission } = usePermissions();
  const canView = !!user && (user.is_superuser || hasPermission("dispatch:view"));
  const canCreate = !!user && (user.is_superuser || hasPermission("dispatch:create"));
  const canPost = !!user && (user.is_superuser || hasPermission("dispatch:post"));
  const canCancel = !!user && (user.is_superuser || hasPermission("dispatch:cancel"));
  const canViewReservations = !!user && (user.is_superuser || hasPermission("reservation:view"));

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [dispatches, setDispatches] = useState<DispatchNote[]>([]);
  const [reservations, setReservations] = useState<StockReservation[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedSalesOrderId, setSelectedSalesOrderId] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [historyTarget, setHistoryTarget] = useState<number | null>(null);
  const [availabilityByProduct, setAvailabilityByProduct] = useState<Record<number, StockAvailability>>({});
  const [allocationRows, setAllocationRows] = useState<Record<number, AllocationDraft[]>>({});
  const [allocationSeedOrderId, setAllocationSeedOrderId] = useState<number | null>(null);

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
  const dispatchOrderNumberById = useMemo(
    () => orders.reduce<Record<number, string>>((acc, item) => ({ ...acc, [item.id]: item.so_number }), {}),
    [orders],
  );

  const eligibleOrders = useMemo(
    () =>
      orders.filter(
        (order) => order.status === "CONFIRMED" || order.status === "PARTIALLY_DISPATCHED",
      ),
    [orders],
  );

  async function load() {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [orderResponse, dispatchResponse, customerResponse, warehouseResponse, productResponse, reservationResponse] =
        await Promise.all([
          apiClient.listSalesOrders(),
          apiClient.listDispatchNotes(),
          apiClient.listParties(),
          apiClient.listWarehouses(),
          apiClient.listProducts(),
          canViewReservations ? apiClient.listReservations() : Promise.resolve({ items: [] }),
        ]);
      setOrders(orderResponse.items);
      setDispatches(dispatchResponse.items);
      setCustomers(customerResponse);
      setWarehouses(warehouseResponse);
      setProducts(productResponse);
      setReservations(reservationResponse.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load dispatch data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [canView, canViewReservations]);

  useEffect(() => {
    if (!selectedSalesOrderId) {
      setSelectedOrder(null);
      setAvailabilityByProduct({});
      return;
    }
    let cancelled = false;
    async function loadSelectedOrder() {
      try {
        const order = await apiClient.getSalesOrder(Number(selectedSalesOrderId));
        if (!cancelled) {
          setSelectedOrder(order);
        }
      } catch (caught) {
        if (!cancelled) {
          setSelectedOrder(null);
          setResult({
            ok: false,
            message: caught instanceof Error ? caught.message : "Failed to load sales order details.",
          });
        }
      }
    }
    void loadSelectedOrder();
    return () => {
      cancelled = true;
    };
  }, [selectedSalesOrderId]);

  useEffect(() => {
    if (!selectedOrder) {
      return;
    }
    const uniqueProductIds = [...new Set(selectedOrder.lines.map((line) => line.product_id))];
    const warehouseId = selectedOrder.warehouse_id;
    let cancelled = false;
    async function loadAvailability() {
      try {
        const responses = await Promise.all(
          uniqueProductIds.map(async (productId) => {
            const availability = await apiClient.getStockAvailability(warehouseId, productId);
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
      }
    }
    void loadAvailability();
    return () => {
      cancelled = true;
    };
  }, [selectedOrder]);

  useEffect(() => {
    if (!selectedOrder || allocationSeedOrderId === selectedOrder.id) {
      return;
    }
    const allAvailabilityLoaded = selectedOrder.lines.every((line) => availabilityByProduct[line.product_id]);
    if (!allAvailabilityLoaded) {
      return;
    }

    const nextRows: Record<number, AllocationDraft[]> = {};
    selectedOrder.lines.forEach((line) => {
      const remainingOrdered = Math.max(0, toNumber(line.ordered_qty) - toNumber(line.dispatched_qty));
      const remainingReserved = toNumber(line.reserved_qty);
      let remainingToAllocate = Math.min(remainingOrdered, remainingReserved);
      const candidates = availabilityByProduct[line.product_id]?.candidate_batches ?? [];
      const generated: AllocationDraft[] = [];
      candidates.forEach((batch, index) => {
        if (remainingToAllocate <= 0) {
          return;
        }
        const batchQty = Math.min(remainingToAllocate, toNumber(batch.qty_on_hand));
        if (batchQty <= 0) {
          return;
        }
        generated.push({
          id: nextAllocationId(line.id, index + 1),
          batchId: String(batch.batch_id),
          qty: batchQty.toString(),
        });
        remainingToAllocate -= batchQty;
      });
      nextRows[line.id] =
        generated.length > 0
          ? generated
          : [{ id: nextAllocationId(line.id, 1), batchId: "", qty: "" }];
    });
    setAllocationRows(nextRows);
    setAllocationSeedOrderId(selectedOrder.id);
  }, [allocationSeedOrderId, availabilityByProduct, selectedOrder]);

  function updateAllocation(lineId: number, allocationId: string, patch: Partial<AllocationDraft>) {
    setAllocationRows((current) => ({
      ...current,
      [lineId]: (current[lineId] ?? []).map((row) =>
        row.id === allocationId ? { ...row, ...patch } : row,
      ),
    }));
  }

  function addAllocation(lineId: number) {
    setAllocationRows((current) => {
      const rows = current[lineId] ?? [];
      return {
        ...current,
        [lineId]: [
          ...rows,
          { id: nextAllocationId(lineId, rows.length + 1), batchId: "", qty: "" },
        ],
      };
    });
  }

  function removeAllocation(lineId: number, allocationId: string) {
    setAllocationRows((current) => {
      const rows = current[lineId] ?? [];
      const filtered = rows.filter((row) => row.id !== allocationId);
      return {
        ...current,
        [lineId]: filtered.length > 0 ? filtered : [{ id: nextAllocationId(lineId, 1), batchId: "", qty: "" }],
      };
    });
  }

  function totalAllocatedQty(lineId: number) {
    return (allocationRows[lineId] ?? []).reduce((acc, row) => acc + toNumber(row.qty), 0);
  }

  async function createDispatchDraft() {
    if (!selectedOrder) {
      setResult({ ok: false, message: "Select a sales order first." });
      return;
    }
    if (!canCreate) {
      setResult({ ok: false, message: "You do not have permission to create dispatch notes." });
      return;
    }

    const flattenedLines = selectedOrder.lines.flatMap((line) => {
      return (allocationRows[line.id] ?? [])
        .filter((row) => row.batchId && toNumber(row.qty) > 0)
        .map((row) => ({
          sales_order_line_id: line.id,
          batch_id: Number(row.batchId),
          dispatched_qty: row.qty,
        }));
    });
    if (flattenedLines.length === 0) {
      setResult({ ok: false, message: "Enter at least one dispatch allocation." });
      return;
    }

    for (const line of selectedOrder.lines) {
      const allocated = totalAllocatedQty(line.id);
      const remainingOrdered = Math.max(0, toNumber(line.ordered_qty) - toNumber(line.dispatched_qty));
      const remainingReserved = toNumber(line.reserved_qty);
      if (allocated > remainingOrdered || allocated > remainingReserved) {
        setResult({
          ok: false,
          message: `Allocated quantity exceeds remaining ordered or reserved quantity for product #${line.product_id}.`,
        });
        return;
      }
    }

    setSubmitting(true);
    setResult(null);
    try {
      const response = await apiClient.createDispatchFromSalesOrder(selectedOrder.id, {
        dispatch_date: dispatchDate,
        remarks: remarks.trim() || undefined,
        lines: flattenedLines,
      });
      setResult({
        ok: true,
        message: `Created draft dispatch ${response.dispatch_number}. Physical stock will reduce only when it is posted.`,
      });
      setRemarks("");
      setDispatchDate(new Date().toISOString().slice(0, 10));
      await load();
      const refreshedOrder = await apiClient.getSalesOrder(selectedOrder.id);
      setSelectedOrder(refreshedOrder);
      setAllocationSeedOrderId(null);
    } catch (caught) {
      setResult({
        ok: false,
        message: caught instanceof Error ? caught.message : "Failed to create dispatch note.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function postDispatch(dispatchId: number) {
    if (!canPost) {
      setResult({ ok: false, message: "You do not have permission to post dispatch notes." });
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const response = await apiClient.postDispatchNote(dispatchId);
      setResult({
        ok: true,
        message: `Posted dispatch ${response.dispatch_number}. Physical stock and reservation balances were updated.`,
      });
      await load();
      if (selectedOrder) {
        const refreshedOrder = await apiClient.getSalesOrder(selectedOrder.id);
        setSelectedOrder(refreshedOrder);
        setAllocationSeedOrderId(null);
      }
    } catch (caught) {
      setResult({
        ok: false,
        message: caught instanceof Error ? caught.message : "Failed to post dispatch note.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelDispatch(dispatchId: number) {
    if (!canCancel) {
      setResult({ ok: false, message: "You do not have permission to cancel dispatch notes." });
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const response = await apiClient.cancelDispatchNote(dispatchId);
      setResult({
        ok: true,
        message: `Cancelled dispatch ${response.dispatch_number}. No physical stock movement was applied.`,
      });
      await load();
    } catch (caught) {
      setResult({
        ok: false,
        message: caught instanceof Error ? caught.message : "Failed to cancel dispatch note.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (!canView) {
    return (
      <div className="space-y-4">
        <PageTitle title="Dispatch Notes" description="Create draft dispatches and post stock outward." />
        <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground shadow-sm">
          You do not have permission to view dispatch notes.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Dispatch Notes"
        description="Use FEFO-aware batch suggestions, allow manual splits, and reduce physical stock only when posting dispatch."
      />

      <AppSectionCard
        title="Create From Sales Order"
        description="Pick a confirmed order, review reserved quantities, and build a draft dispatch using FEFO batch suggestions."
      >
        <AppFormGrid className="md:grid-cols-3">
          <label className="space-y-1">
            <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Sales Order</span>
            <select
              value={selectedSalesOrderId}
              onChange={(event) => {
                setSelectedSalesOrderId(event.target.value);
                setAllocationSeedOrderId(null);
                setResult(null);
              }}
              className={selectClassName}
            >
              <option value="">Select sales order</option>
              {eligibleOrders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.so_number} • {customerNameById[order.customer_id] ?? `Customer #${order.customer_id}`}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Dispatch Date</span>
            <Input type="date" value={dispatchDate} onChange={(event) => setDispatchDate(event.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Remarks</span>
            <Input value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Optional remarks" />
          </label>
        </AppFormGrid>

        {!selectedOrder ? (
          <p className="text-sm text-muted-foreground">Select a confirmed sales order to create a draft dispatch.</p>
        ) : (
          <>
            <AppSummaryPanel className="border border-[hsl(var(--card-border))] bg-[hsl(var(--muted-bg))] shadow-none">
              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Sales Order</p>
                  <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">{selectedOrder.so_number}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Customer</p>
                  <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">
                    {customerNameById[selectedOrder.customer_id] ?? `Customer #${selectedOrder.customer_id}`}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Warehouse</p>
                  <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">
                    {warehouseNameById[selectedOrder.warehouse_id] ?? `Warehouse #${selectedOrder.warehouse_id}`}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Status</p>
                  <div className="mt-1">
                    <SalesOrderStatusBadge status={selectedOrder.status} />
                  </div>
                </div>
              </div>
            </AppSummaryPanel>

            <div className="space-y-4">
              {selectedOrder.lines.map((line) => {
                const availability = availabilityByProduct[line.product_id];
                const product = productById[line.product_id];
                const precision = product?.quantity_precision ?? 2;
                const remainingOrdered = Math.max(0, toNumber(line.ordered_qty) - toNumber(line.dispatched_qty));
                const remainingReserved = toNumber(line.reserved_qty);
                const lineReservations = reservations.filter((reservation) => reservation.sales_order_line_id === line.id);

                return (
                  <AppSectionCard
                    key={line.id}
                    title={product ? `${product.name} (${product.sku})` : `Product #${line.product_id}`}
                    description="FEFO candidates are suggested from earliest expiry first. Manual split across batches is allowed."
                    className="shadow-none"
                  >
                    <AppSummaryPanel className="border border-[hsl(var(--card-border))] shadow-none">
                      <div className="grid gap-3 md:grid-cols-5">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Ordered</p>
                          <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">
                            {formatQuantity(line.ordered_qty, precision)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Dispatched</p>
                          <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">
                            {formatQuantity(line.dispatched_qty, precision)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Reserved</p>
                          <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">
                            {formatQuantity(line.reserved_qty, precision)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Remaining Ordered</p>
                          <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">
                            {remainingOrdered.toFixed(precision)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">Allocated Draft Qty</p>
                          <p className="mt-1 text-sm font-medium text-[hsl(var(--text-primary))]">
                            {totalAllocatedQty(line.id).toFixed(precision)}
                          </p>
                        </div>
                      </div>
                    </AppSummaryPanel>

                    {availability ? (
                      <div className="rounded-xl border border-[hsl(var(--card-border))] bg-[hsl(var(--muted-bg))] p-4 text-sm">
                        <span className="font-medium text-[hsl(var(--text-primary))]">
                          On Hand {formatQuantity(availability.on_hand_qty, precision)}
                        </span>
                        <span className="mx-2 text-[hsl(var(--text-secondary))]">|</span>
                        <span className="font-medium text-[hsl(var(--text-primary))]">
                          Reserved {formatQuantity(availability.reserved_qty, precision)}
                        </span>
                        <span className="mx-2 text-[hsl(var(--text-secondary))]">|</span>
                        <span className="font-medium text-[hsl(var(--text-primary))]">
                          Available {formatQuantity(availability.available_qty, precision)}
                        </span>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Loading batch availability...</p>
                    )}

                    <div className="space-y-3">
                      {(allocationRows[line.id] ?? []).map((row, index) => (
                        <div key={row.id} className="grid gap-3 rounded-xl border border-[hsl(var(--card-border))] p-4 md:grid-cols-[1.5fr_1fr_auto]">
                          <label className="space-y-1">
                            <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Batch</span>
                            <select
                              value={row.batchId}
                              onChange={(event) => updateAllocation(line.id, row.id, { batchId: event.target.value })}
                              className={selectClassName}
                            >
                              <option value="">Select batch</option>
                              {(availability?.candidate_batches ?? []).map((batch) => (
                                <option key={batch.batch_id} value={batch.batch_id}>
                                  {batch.batch_no} • {batch.expiry_date} • Qty {batch.qty_on_hand}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-1">
                            <span className="text-sm font-medium text-[hsl(var(--text-secondary))]">Dispatch Qty</span>
                            <Input
                              value={row.qty}
                              onChange={(event) => updateAllocation(line.id, row.id, { qty: event.target.value })}
                            />
                          </label>
                          <div className="flex items-end justify-end gap-2">
                            {index === (allocationRows[line.id] ?? []).length - 1 ? (
                              <Button type="button" variant="outline" onClick={() => addAllocation(line.id)}>
                                Split
                              </Button>
                            ) : null}
                            <Button type="button" variant="outline" onClick={() => removeAllocation(line.id, row.id)}>
                              Remove
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {lineReservations.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {lineReservations.map((reservation) => (
                          <div key={reservation.id} className="rounded-xl border border-[hsl(var(--card-border))] px-3 py-2 text-xs">
                            <div className="mb-1">
                              <ReservationStatusBadge status={reservation.status} />
                            </div>
                            Reserved {reservation.reserved_qty} | Consumed {reservation.consumed_qty} | Released{" "}
                            {reservation.released_qty}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="overflow-auto rounded-xl border border-[hsl(var(--card-border))]">
                      <Table className="min-w-[620px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Suggested Batch</TableHead>
                            <TableHead>Expiry</TableHead>
                            <TableHead className="text-right">Qty On Hand</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(availability?.candidate_batches ?? []).length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                                No FEFO batch suggestions available.
                              </TableCell>
                            </TableRow>
                          ) : (
                            (availability?.candidate_batches ?? []).map((batch) => (
                              <TableRow key={batch.batch_id}>
                                <TableCell>{batch.batch_no}</TableCell>
                                <TableCell>{batch.expiry_date}</TableCell>
                                <TableCell className="text-right">{formatQuantity(batch.qty_on_hand, precision)}</TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    {(totalAllocatedQty(line.id) > remainingOrdered || totalAllocatedQty(line.id) > remainingReserved) ? (
                      <p className="text-sm text-rose-600">
                        Allocated quantity exceeds remaining ordered or reserved quantity for this line.
                      </p>
                    ) : null}
                  </AppSectionCard>
                );
              })}
            </div>

            <AppActionBar>
              <Button type="button" onClick={createDispatchDraft} disabled={!canCreate || submitting}>
                {submitting ? "Saving..." : "Create Draft Dispatch"}
              </Button>
            </AppActionBar>
          </>
        )}

        {result ? (
          <p className={result.ok ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>{result.message}</p>
        ) : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      </AppSectionCard>

      <AppTable title="Dispatch Notes" description="Draft, post, and cancel outward documents while preserving immutable stock ledger history.">
        <Table className="min-w-[1080px]">
          <TableHeader>
            <TableRow>
              <TableHead>Dispatch No</TableHead>
              <TableHead>Sales Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Dispatch Date</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  Loading dispatch notes...
                </TableCell>
              </TableRow>
            ) : dispatches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  No dispatch notes created yet.
                </TableCell>
              </TableRow>
            ) : (
              dispatches.map((dispatch) => (
                <TableRow key={dispatch.id}>
                  <TableCell className="font-medium text-[hsl(var(--text-primary))]">{dispatch.dispatch_number}</TableCell>
                  <TableCell>{dispatchOrderNumberById[dispatch.sales_order_id] ?? `SO #${dispatch.sales_order_id}`}</TableCell>
                  <TableCell>{customerNameById[dispatch.customer_id] ?? `Customer #${dispatch.customer_id}`}</TableCell>
                  <TableCell>{warehouseNameById[dispatch.warehouse_id] ?? `Warehouse #${dispatch.warehouse_id}`}</TableCell>
                  <TableCell><DispatchStatusBadge status={dispatch.status} /></TableCell>
                  <TableCell>{dispatch.dispatch_date}</TableCell>
                  <TableCell className="text-right">{dispatch.lines.length}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {dispatch.status === "DRAFT" ? (
                        <Button type="button" size="sm" onClick={() => void postDispatch(dispatch.id)} disabled={!canPost || submitting}>
                          Post
                        </Button>
                      ) : null}
                      {dispatch.status === "DRAFT" ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => void cancelDispatch(dispatch.id)} disabled={!canCancel || submitting}>
                          Cancel
                        </Button>
                      ) : null}
                      <Button type="button" variant="outline" size="sm" onClick={() => setHistoryTarget(dispatch.id)}>
                        History
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </AppTable>

      <RecordHistoryDrawer
        open={historyTarget !== null}
        onClose={() => setHistoryTarget(null)}
        entityType="DISPATCH_NOTE"
        entityId={historyTarget}
        title="Dispatch History"
      />
    </div>
  );
}
