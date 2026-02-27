"use client";

import { useEffect, useMemo, useState } from "react";

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
import { Product, ProductPayload, apiClient } from "@/lib/api/client";

type FormState = {
  sku: string;
  name: string;
  brand: string;
  uom: string;
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
  barcode: "",
  hsn: "",
  gst_rate: "",
  is_active: true,
};

export function ProductsManager() {
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialState);

  const modeLabel = useMemo(
    () => (editingId ? "Update Product" : "Add Product"),
    [editingId],
  );

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiClient.listProducts();
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products");
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
    setEditingId(item.id);
    setForm({
      sku: item.sku,
      name: item.name,
      brand: item.brand ?? "",
      uom: item.uom,
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
                setForm((prev) => ({ ...prev, uom: event.target.value }))
              }
              placeholder="UOM"
              required
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
            <Input
              value={form.gst_rate}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, gst_rate: event.target.value }))
              }
              placeholder="GST Rate"
              type="number"
            />
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
                    <TableCell>{item.gst_rate ?? "-"}</TableCell>
                    <TableCell>
                      {item.is_active ? "Active" : "Inactive"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(item)}
                      >
                        Edit
                      </Button>
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
