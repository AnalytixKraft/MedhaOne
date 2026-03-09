"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppPageHeader, AppTable, FilterCard } from "@/components/erp/app-primitives";
import { usePermissions } from "@/components/auth/permission-provider";
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
import { Grn, GrnListQuery, Party, Warehouse, apiClient } from "@/lib/api/client";

const STATUS_OPTIONS = [
  { label: "All Statuses", value: "" },
  { label: "Draft", value: "DRAFT" },
  { label: "Posted", value: "POSTED" },
  { label: "Cancelled", value: "CANCELLED" },
];

export function GrnList() {
  const { hasPermission } = usePermissions();
  const [grns, setGrns] = useState<Grn[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [filters, setFilters] = useState<GrnListQuery>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [grnData, partyData, warehouseData] = await Promise.all([
        apiClient.listGrns(filters),
        apiClient.listParties(),
        apiClient.listWarehouses(),
      ]);
      setGrns(grnData);
      setSuppliers(
        partyData.filter((party) => party.party_type === "SUPPLIER" || party.party_type === "BOTH"),
      );
      setWarehouses(warehouseData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load GRNs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const supplierOptions = useMemo(
    () => [{ label: "All Suppliers", value: "" }].concat(
      suppliers.map((supplier) => ({
        label: supplier.party_name || supplier.name,
        value: String(supplier.id),
      })),
    ),
    [suppliers],
  );

  const warehouseOptions = useMemo(
    () => [{ label: "All Warehouses", value: "" }].concat(
      warehouses.map((warehouse) => ({
        label: warehouse.name,
        value: String(warehouse.id),
      })),
    ),
    [warehouses],
  );

  const applyFilters = async () => {
    await load();
  };

  return (
    <div className="space-y-6">
      <AppPageHeader
        title="Goods Receipt Notes"
        description="Track draft and posted receipts against purchase orders and linked purchase bills."
        actions={
          <>
            {hasPermission("grn:create") ? (
              <>
                <Button asChild variant="outline">
                  <Link href="/purchase/grn/from-bill">Create From Bill</Link>
                </Button>
                <Button asChild>
                  <Link href="/purchase/grn/new">Create From PO</Link>
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <FilterCard
        title="Filters"
        description="Filter GRNs by document, supplier, warehouse, status, and receipt date."
        actions={
          <>
            <Button variant="outline" onClick={() => setFilters({})}>
              Clear
            </Button>
            <Button onClick={() => void applyFilters()}>Apply Filters</Button>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Input
            placeholder="Search GRN / PO / Bill"
            value={filters.search ?? ""}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value || undefined }))}
          />
          <ErpCombobox
            options={STATUS_OPTIONS}
            value={filters.status ?? ""}
            onValueChange={(value) =>
              setFilters((current) => ({ ...current, status: value || undefined }))
            }
            placeholder="Select status"
            searchPlaceholder="Search status"
            emptyMessage="No statuses"
          />
          <ErpCombobox
            options={supplierOptions}
            value={filters.supplier_id ? String(filters.supplier_id) : ""}
            onValueChange={(value) =>
              setFilters((current) => ({
                ...current,
                supplier_id: value ? Number(value) : undefined,
              }))
            }
            placeholder="Select supplier"
            searchPlaceholder="Search supplier"
            emptyMessage="No suppliers"
          />
          <ErpCombobox
            options={warehouseOptions}
            value={filters.warehouse_id ? String(filters.warehouse_id) : ""}
            onValueChange={(value) =>
              setFilters((current) => ({
                ...current,
                warehouse_id: value ? Number(value) : undefined,
              }))
            }
            placeholder="Select warehouse"
            searchPlaceholder="Search warehouse"
            emptyMessage="No warehouses"
          />
          <Input
            type="date"
            value={filters.date_from ?? ""}
            onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value || undefined }))}
          />
          <Input
            type="date"
            value={filters.date_to ?? ""}
            onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value || undefined }))}
          />
          <Input
            placeholder="PO Number"
            value={filters.po_number ?? ""}
            onChange={(event) => setFilters((current) => ({ ...current, po_number: event.target.value || undefined }))}
          />
          <Input
            placeholder="Bill Number"
            value={filters.bill_number ?? ""}
            onChange={(event) => setFilters((current) => ({ ...current, bill_number: event.target.value || undefined }))}
          />
        </div>
      </FilterCard>

      <AppTable title="GRN Register" description="Warehouse receiving documents with PO and bill linkage.">
        {loading ? <p className="p-4 text-sm text-muted-foreground">Loading GRNs...</p> : null}
        {error ? <p className="p-4 text-sm text-red-500">{error}</p> : null}
        {!loading && !error ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>GRN Number</TableHead>
                <TableHead>GRN Date</TableHead>
                <TableHead>PO Number</TableHead>
                <TableHead>Bill Number</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total Products</TableHead>
                <TableHead>Total Received Qty</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grns.map((grn) => (
                <TableRow key={grn.id}>
                  <TableCell className="font-medium">
                    <Link href={`/purchase/grn/${grn.id}`}>{grn.grn_number}</Link>
                  </TableCell>
                  <TableCell>{grn.received_date}</TableCell>
                  <TableCell>{grn.po_number ?? "-"}</TableCell>
                  <TableCell>{grn.purchase_bill_number ?? "-"}</TableCell>
                  <TableCell>{grn.supplier_name ?? "-"}</TableCell>
                  <TableCell>{grn.warehouse_name ?? "-"}</TableCell>
                  <TableCell>
                    <span data-testid="status-badge">{grn.status}</span>
                  </TableCell>
                  <TableCell>{grn.total_products}</TableCell>
                  <TableCell>{grn.total_received_qty}</TableCell>
                  <TableCell>{grn.created_by_name ?? "-"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/purchase/grn/${grn.id}`}>View</Link>
                      </Button>
                      {grn.status === "DRAFT" && hasPermission("grn:edit") ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/purchase/grn/${grn.id}/edit`}>Edit</Link>
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!grns.length ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                    No GRNs found for the current filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        ) : null}
      </AppTable>
    </div>
  );
}
