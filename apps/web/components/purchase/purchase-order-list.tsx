"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { usePermissions } from "@/components/auth/permission-provider";
import { AppPageHeader, AppTable, FilterCard } from "@/components/erp/app-primitives";
import { PurchaseOrderStatusBadge } from "@/components/purchase/purchase-order-status-badge";
import { Button } from "@/components/ui/button";
import { ErpCombobox } from "@/components/ui/erp-combobox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiClient, Party, PurchaseOrder, PurchaseOrderStatus, Warehouse } from "@/lib/api/client";

const amountFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type SortKey = "po_number" | "order_date" | "final_total" | "updated_at";

export function PurchaseOrderList() {
  const { user, hasPermission } = usePermissions();
  const canView = !!user && (user.is_superuser || hasPermission("purchase:view"));
  const canApprove = !!user && (user.is_superuser || hasPermission("purchase:approve"));
  const canUpdate = !!user && (user.is_superuser || hasPermission("purchase:update"));
  const canCancel = !!user && (user.is_superuser || hasPermission("purchase:cancel"));

  const [items, setItems] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | "ALL">("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [workingId, setWorkingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [orders, parties, warehouseRes] = await Promise.all([
        apiClient.listPurchaseOrders({
          search,
          supplier_id: supplierId ? Number(supplierId) : undefined,
          warehouse_id: warehouseId ? Number(warehouseId) : undefined,
          status: statusFilter === "ALL" ? undefined : statusFilter,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
        }),
        apiClient.listParties(),
        apiClient.listWarehouses(),
      ]);
      setItems(orders.items);
      setSuppliers(parties.filter((party) => party.party_type === "SUPPLIER" || party.party_type === "BOTH"));
      setWarehouses(warehouseRes);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load purchase orders.");
    } finally {
      setLoading(false);
    }
  }, [canView, dateFrom, dateTo, search, statusFilter, supplierId, warehouseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedItems = useMemo(() => {
    const list = [...items];
    list.sort((left, right) => {
      const direction = sortDirection === "asc" ? 1 : -1;
      if (sortKey === "final_total") {
        return (
          (Number.parseFloat(left.final_total) - Number.parseFloat(right.final_total)) * direction
        );
      }
      const leftValue = String(left[sortKey] ?? "");
      const rightValue = String(right[sortKey] ?? "");
      return leftValue.localeCompare(rightValue) * direction;
    });
    return list;
  }, [items, sortDirection, sortKey]);

  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const pagedItems = sortedItems.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const supplierOptions = suppliers.map((supplier) => ({ label: supplier.name, value: String(supplier.id) }));
  const warehouseOptions = warehouses.map((warehouse) => ({ label: warehouse.name, value: String(warehouse.id) }));

  async function handleApprove(id: number) {
    setWorkingId(id);
    setError(null);
    try {
      await apiClient.approvePurchaseOrder(id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to approve purchase order.");
    } finally {
      setWorkingId(null);
    }
  }

  async function handleCancel(id: number) {
    setWorkingId(id);
    setError(null);
    try {
      await apiClient.cancelPurchaseOrder(id);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to cancel purchase order.");
    } finally {
      setWorkingId(null);
    }
  }

  if (!canView) {
    return <p className="text-sm text-muted-foreground">You do not have permission to view purchase orders.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader
        title="Purchase Orders"
        description="Review, filter, approve, and track purchase order documents."
        actions={
          <Button asChild>
            <Link href="/purchase-orders/new">New Purchase Order</Link>
          </Button>
        }
      />

      {error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      ) : null}

      <FilterCard title="Filters" description="Filter purchase orders by date, supplier, warehouse, status, and PO number.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
              Search
            </span>
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by PO number" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
              Supplier
            </span>
            <ErpCombobox
              options={supplierOptions}
              value={supplierId}
              onValueChange={setSupplierId}
              placeholder="All suppliers"
              searchPlaceholder="Search supplier"
              emptyMessage="No matching suppliers"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
              Warehouse
            </span>
            <ErpCombobox
              options={warehouseOptions}
              value={warehouseId}
              onValueChange={setWarehouseId}
              placeholder="All warehouses"
              searchPlaceholder="Search warehouse"
              emptyMessage="No matching warehouses"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
              Status
            </span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as PurchaseOrderStatus | "ALL")}
              className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="ALL">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="APPROVED">Approved</option>
              <option value="PARTIALLY_RECEIVED">Partially Received</option>
              <option value="CLOSED">Closed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
              Date From
            </span>
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
              Date To
            </span>
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
              Sort By
            </span>
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as SortKey)}
              className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="updated_at">Updated At</option>
              <option value="order_date">PO Date</option>
              <option value="po_number">PO Number</option>
              <option value="final_total">Total</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
              Direction
            </span>
            <select
              value={sortDirection}
              onChange={(event) => setSortDirection(event.target.value as "asc" | "desc")}
              className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => {
            setSearch("");
            setSupplierId("");
            setWarehouseId("");
            setStatusFilter("ALL");
            setDateFrom("");
            setDateTo("");
          }}>
            Clear Filters
          </Button>
          <Button type="button" onClick={() => void load()}>
            Apply Filters
          </Button>
        </div>
      </FilterCard>

      <AppTable title="Purchase Orders" description={loading ? "Loading purchase orders..." : `${sortedItems.length} purchase orders found.`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO Number</TableHead>
              <TableHead>PO Date</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Created By</TableHead>
              <TableHead>Updated At</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  No purchase orders found.
                </TableCell>
              </TableRow>
            ) : (
              pagedItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link className="font-medium text-sky-700 hover:underline" href={`/purchase-orders/${item.id}`}>
                      {item.po_number}
                    </Link>
                  </TableCell>
                  <TableCell>{item.order_date}</TableCell>
                  <TableCell>{item.supplier_name ?? `Supplier #${item.supplier_id}`}</TableCell>
                  <TableCell>{item.warehouse_name ?? `Warehouse #${item.warehouse_id}`}</TableCell>
                  <TableCell>
                    <PurchaseOrderStatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{amountFormatter.format(Number.parseFloat(item.final_total))}</TableCell>
                  <TableCell>{item.created_by_name ?? `User #${item.created_by}`}</TableCell>
                  <TableCell>{new Date(item.updated_at).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/purchase-orders/${item.id}`}>View</Link>
                      </Button>
                      {item.status === "DRAFT" && canUpdate ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/purchase-orders/${item.id}/edit`}>Edit</Link>
                        </Button>
                      ) : null}
                      {item.status === "DRAFT" && canApprove ? (
                        <Button
                          size="sm"
                          onClick={() => void handleApprove(item.id)}
                          disabled={workingId === item.id}
                        >
                          Approve
                        </Button>
                      ) : null}
                      {item.status === "DRAFT" && canCancel ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleCancel(item.id)}
                          disabled={workingId === item.id}
                        >
                          Cancel
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" disabled>
                        Print
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
          <span>
            Page {page} of {pageCount}
          </span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              Previous
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>
              Next
            </Button>
          </div>
        </div>
      </AppTable>
    </div>
  );
}
