"use client";

import { useEffect, useMemo, useState } from "react";

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
import { Product, ProductPayload, TaxRate, apiClient } from "@/lib/api/client";
import {
  inferQuantityPrecisionFromUom,
  normalizeQuantityPrecision,
} from "@/lib/quantity";

type FormState = {
  sku: string;
  name: string;
  brand: string;
  uom: string;
  quantity_precision: string;
  barcode: string;
  hsn: string;
  gst_rate: string;
  is_active: boolean;
};

const initialState: FormState = {
  sku: "",
  name: "",
  brand: "",
  uom: "BOX",
  quantity_precision: "0",
  barcode: "",
  hsn: "",
  gst_rate: "",
  is_active: true,
};

export function ProductsManager() {
  const { user, hasPermission, loading: permissionsLoading } = usePermissions();
  const [items, setItems] = useState<Product[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialState);

  const modeLabel = useMemo(
    () => (editingId ? "Update Product" : "Add Product"),
    [editingId],
  );
  const canManage = !!user && (user.is_superuser || hasPermission("masters:manage"));
  const taxRateOptions = useMemo(() => {
    return [...taxRates].sort(
      (left, right) =>
        Number.parseFloat(left.rate_percent) - Number.parseFloat(right.rate_percent),
    );
  }, [taxRates]);
  const gstLabelByRate = useMemo(() => {
    const map = new Map<string, string>();
    for (const taxRate of taxRateOptions) {
      map.set(
        Number.parseFloat(taxRate.rate_percent).toFixed(2),
        taxRate.label,
      );
    }
    return map;
  }, [taxRateOptions]);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const [productsResult, taxRatesResult] = await Promise.allSettled([
        apiClient.listProducts(),
        apiClient.listTaxRates(false),
      ]);

      if (productsResult.status === "rejected") {
        throw productsResult.reason;
      }

      setItems(productsResult.value);

      if (taxRatesResult.status === "fulfilled") {
        setTaxRates(taxRatesResult.value);
      } else {
        setTaxRates([]);
        setError("Tax rates could not be loaded. GST dropdown is unavailable.");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load products and tenant tax rates",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const resetForm = () => {
    setForm(initialState);
    setEditingId(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload: ProductPayload = {
      sku: form.sku,
      name: form.name,
      brand: form.brand || undefined,
      uom: form.uom,
      quantity_precision: normalizeQuantityPrecision(
        Number.parseInt(form.quantity_precision || "0", 10),
      ),
      barcode: form.barcode || undefined,
      hsn: form.hsn || undefined,
      gst_rate: form.gst_rate || undefined,
      is_active: form.is_active,
    };

    try {
      if (editingId) {
        await apiClient.updateProduct(editingId, payload);
      } else {
        await apiClient.createProduct(payload);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save product");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (item: Product) => {
    if (!canManage) {
      return;
    }
    setEditingId(item.id);
    setForm({
      sku: item.sku,
      name: item.name,
      brand: item.brand ?? "",
      uom: item.uom,
      quantity_precision: String(item.quantity_precision),
      barcode: item.barcode ?? "",
      hsn: item.hsn ?? "",
      gst_rate: item.gst_rate ?? "",
      is_active: item.is_active,
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
      <Card>
        <CardHeader>
          <CardTitle>{modeLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          {!permissionsLoading && !canManage ? (
            <p className="text-sm text-muted-foreground">
              You have read-only access. Master data changes are disabled for your role.
            </p>
          ) : (
          <form className="space-y-3" onSubmit={handleSubmit}>
            <Input
              data-testid="product-sku"
              value={form.sku}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, sku: event.target.value }))
              }
              placeholder="SKU"
              required
            />
            <Input
              data-testid="product-name"
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Product name"
              required
            />
            <Input
              value={form.brand}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, brand: event.target.value }))
              }
              placeholder="Brand"
            />
            <Input
              value={form.uom}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  uom: event.target.value,
                  quantity_precision: String(
                    inferQuantityPrecisionFromUom(event.target.value),
                  ),
                }))
              }
              placeholder="UOM"
              required
            />
            <Input
              value={form.quantity_precision}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  quantity_precision: event.target.value.replace(/[^0-9]/g, "").slice(0, 1),
                }))
              }
              placeholder="Qty precision"
              type="number"
              min="0"
              max="3"
              step="1"
            />
            <Input
              value={form.barcode}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, barcode: event.target.value }))
              }
              placeholder="Barcode"
            />
            <Input
              value={form.hsn}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, hsn: event.target.value }))
              }
              placeholder="HSN"
            />
            <label className="space-y-2">
              <span className="text-xs text-muted-foreground">GST Rate</span>
              <select
                value={
                  form.gst_rate
                    ? Number.parseFloat(form.gst_rate).toFixed(2)
                    : ""
                }
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, gst_rate: event.target.value }))
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Select GST rate</option>
                {taxRateOptions.map((taxRate) => {
                  const normalized = Number.parseFloat(taxRate.rate_percent).toFixed(2);
                  return (
                    <option key={taxRate.code} value={normalized}>
                      {taxRate.label} ({normalized}%)
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    is_active: event.target.checked,
                  }))
                }
              />
              Active
            </label>

            <div className="flex gap-2">
              <Button
                data-testid="create-product"
                type="submit"
                disabled={saving}
              >
                {saving ? "Saving..." : modeLabel}
              </Button>
              {editingId ? (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Products</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? <p className="mb-3 text-sm text-red-500">{error}</p> : null}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading products...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead>Qty Precision</TableHead>
                  <TableHead>GST</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.sku}</TableCell>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>{item.uom}</TableCell>
                    <TableCell>{item.quantity_precision}</TableCell>
                    <TableCell>
                      {item.gst_rate
                        ? `${gstLabelByRate.get(
                            Number.parseFloat(item.gst_rate).toFixed(2),
                          ) ?? "GST"} (${Number.parseFloat(item.gst_rate).toFixed(2)}%)`
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {item.is_active ? "Active" : "Inactive"}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(item)}
                        >
                          Edit
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">View only</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
