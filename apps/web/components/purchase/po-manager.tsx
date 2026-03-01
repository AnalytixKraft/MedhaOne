"use client";

import { useEffect, useState } from "react";

import { usePermissions } from "@/components/auth/permission-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Party,
  Product,
  Warehouse,
} from "@/lib/api/client";

type DraftLine = {
  product_id: string;
  ordered_qty: string;
  unit_cost: string;
  free_qty: string;
};

const emptyLine = (): DraftLine => ({
  product_id: "",
  ordered_qty: "",
  unit_cost: "",
  free_qty: "0",
});

export function PurchaseOrderManager() {
  const { hasPermission, loading: permissionLoading } = usePermissions();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [orderDate, setOrderDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const [poRes, parties, warehouseRes, productRes] = await Promise.all([
        apiClient.listPurchaseOrders(),
        apiClient.listParties(),
        apiClient.listWarehouses(),
        apiClient.listProducts(),
      ]);
      setPurchaseOrders(poRes.items);
      setSuppliers(parties);
      setWarehouses(warehouseRes);
      setProducts(productRes);
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

  const updateLine = (index: number, patch: Partial<DraftLine>) => {
    setLines((prev) =>
      prev.map((line, idx) => (idx === index ? { ...line, ...patch } : line)),
    );
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);

  const removeLine = (index: number) => {
    setLines((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== index),
    );
  };

  const resetForm = () => {
    setSupplierId("");
    setWarehouseId("");
    setOrderDate(new Date().toISOString().slice(0, 10));
    setLines([emptyLine()]);
  };

  const handleCreatePo = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
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

  return (
    <div className="grid gap-6 lg:grid-cols-[420px,1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Create Purchase Order</CardTitle>
        </CardHeader>
        <CardContent>
          {permissionLoading ? (
            <p className="text-sm text-muted-foreground">Loading permissions...</p>
          ) : hasPermission("purchase:create") ? (
            <form className="space-y-3" onSubmit={handleCreatePo}>
            <select
              data-testid="po-supplier-select"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              required
            >
              <option value="">Select supplier</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>

            <select
              data-testid="po-warehouse-select"
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              required
            >
              <option value="">Select warehouse</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>

            <Input
              type="date"
              value={orderDate}
              onChange={(event) => setOrderDate(event.target.value)}
              required
            />

            <div className="space-y-2">
              {lines.map((line, index) => (
                <div key={index} className="grid gap-2 rounded-md border p-2">
                  <select
                    data-testid={`po-line-product-${index}`}
                    value={line.product_id}
                    onChange={(event) =>
                      updateLine(index, { product_id: event.target.value })
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    required
                  >
                    <option value="">Select product</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.sku} - {product.name}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      data-testid={`po-line-qty-${index}`}
                      value={line.ordered_qty}
                      onChange={(event) =>
                        updateLine(index, { ordered_qty: event.target.value })
                      }
                      placeholder="Qty"
                      type="number"
                      step="0.001"
                      required
                    />
                    <Input
                      value={line.unit_cost}
                      onChange={(event) =>
                        updateLine(index, { unit_cost: event.target.value })
                      }
                      placeholder="Unit cost"
                      type="number"
                      step="0.0001"
                    />
                    <Input
                      value={line.free_qty}
                      onChange={(event) =>
                        updateLine(index, { free_qty: event.target.value })
                      }
                      placeholder="Free"
                      type="number"
                      step="0.001"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => removeLine(index)}
                  >
                    Remove line
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={addLine}>
                Add line
              </Button>
              <Button data-testid="create-po" type="submit" disabled={saving}>
                {saving ? "Saving..." : "Create PO"}
              </Button>
            </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              You do not have permission to create purchase orders.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Purchase Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? <p className="mb-3 text-sm text-red-500">{error}</p> : null}
          {loading ? (
            <p className="text-sm text-muted-foreground">
              Loading purchase orders...
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO No</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Lines</TableHead>
                  <TableHead className="text-right">Action</TableHead>
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
                    <TableRow key={po.id} data-testid="po-row">
                      <TableCell data-testid="po-number">
                        {po.po_number}
                      </TableCell>
                      <TableCell>
                        <span data-testid="status-badge">{po.status}</span>
                      </TableCell>
                      <TableCell>{supplierName}</TableCell>
                      <TableCell>{warehouseName}</TableCell>
                      <TableCell>{po.lines.length}</TableCell>
                      <TableCell className="text-right">
                        {po.status === "DRAFT" && hasPermission("purchase:approve") ? (
                          <Button
                            data-testid="approve-po"
                            size="sm"
                            variant="outline"
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
