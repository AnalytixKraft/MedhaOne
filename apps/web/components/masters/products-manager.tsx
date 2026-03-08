"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Trash2 } from "lucide-react";

import { AppActionBar, AppTable } from "@/components/erp/app-primitives";
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
  apiClient,
  type BulkImportError,
  type Product,
  type ProductPayload,
  type TaxRate,
} from "@/lib/api/client";
import {
  inferQuantityPrecisionFromUom,
  normalizeQuantityPrecision,
} from "@/lib/quantity";
import { cn } from "@/lib/utils";

const DEFAULT_UOM = "BOX";

type GridField =
  | "sku"
  | "name"
  | "brand"
  | "uom"
  | "quantity_precision"
  | "barcode"
  | "hsn"
  | "gst_rate"
  | "is_active";

type DraftProductRow = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  uom: string;
  quantity_precision: string;
  quantity_precision_overridden: boolean;
  barcode: string;
  hsn: string;
  gst_rate: string;
  is_active: boolean;
};

type RowErrors = Partial<Record<GridField, string>>;

function normalizeTaxRateValue(value: string): string {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    return "";
  }
  return parsed.toFixed(2);
}

function createEmptyRow(id: number): DraftProductRow {
  return {
    id: `product-row-${id}`,
    sku: "",
    name: "",
    brand: "",
    uom: DEFAULT_UOM,
    quantity_precision: String(inferQuantityPrecisionFromUom(DEFAULT_UOM)),
    quantity_precision_overridden: false,
    barcode: "",
    hsn: "",
    gst_rate: "",
    is_active: true,
  };
}

function isRowBlank(row: DraftProductRow): boolean {
  return !(
    row.sku.trim() ||
    row.name.trim() ||
    row.brand.trim() ||
    row.uom.trim() ||
    row.barcode.trim() ||
    row.hsn.trim() ||
    row.gst_rate.trim()
  );
}

function validateRow(row: DraftProductRow): RowErrors {
  const errors: RowErrors = {};
  if (!row.sku.trim()) {
    errors.sku = "SKU is required";
  }
  if (!row.name.trim()) {
    errors.name = "Name is required";
  }
  if (!row.uom.trim()) {
    errors.uom = "UOM is required";
  }

  const precisionText = row.quantity_precision.trim();
  if (!precisionText || !/^\d+$/.test(precisionText)) {
    errors.quantity_precision = "Qty precision is required";
  } else {
    const parsed = Number.parseInt(precisionText, 10);
    if (parsed < 0 || parsed > 3) {
      errors.quantity_precision = "Qty precision must be between 0 and 3";
    }
  }

  const hsn = row.hsn.trim();
  if (hsn && !/^\d{4,8}$/.test(hsn)) {
    errors.hsn = "HSN must be 4 to 8 digits";
  }

  if (row.gst_rate.trim() && !/^\d+(\.\d{1,2})?$/.test(row.gst_rate.trim())) {
    errors.gst_rate = "Invalid GST rate";
  }

  return errors;
}

export function ProductsManager() {
  const { user, hasPermission, loading: permissionsLoading } = usePermissions();
  const [items, setItems] = useState<Product[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [rows, setRows] = useState<DraftProductRow[]>([createEmptyRow(1)]);
  const [rowErrors, setRowErrors] = useState<Record<string, RowErrors>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const nextRowId = useRef(2);
  const cellRefs = useRef<Record<string, HTMLElement | null>>({});
  const pendingFocus = useRef<{ rowId: string; field: GridField } | null>(null);

  const canManage = !!user && (user.is_superuser || hasPermission("masters:manage"));

  const taxRateOptions = useMemo(
    () =>
      [...taxRates].sort(
        (left, right) =>
          Number.parseFloat(left.rate_percent) - Number.parseFloat(right.rate_percent),
      ),
    [taxRates],
  );

  const activeTaxRates = useMemo(
    () => new Set(taxRateOptions.map((rate) => normalizeTaxRateValue(rate.rate_percent))),
    [taxRateOptions],
  );

  const gstLabelByRate = useMemo(() => {
    const map = new Map<string, string>();
    for (const taxRate of taxRateOptions) {
      map.set(normalizeTaxRateValue(taxRate.rate_percent), taxRate.label);
    }
    return map;
  }, [taxRateOptions]);

  const registerCell = useCallback(
    (rowId: string, field: GridField, element: HTMLElement | null) => {
      cellRefs.current[`${rowId}:${field}`] = element;
    },
    [],
  );

  const focusCell = useCallback((rowId: string, field: GridField) => {
    cellRefs.current[`${rowId}:${field}`]?.focus();
  }, []);

  useEffect(() => {
    if (!pendingFocus.current) {
      return;
    }
    const target = pendingFocus.current;
    pendingFocus.current = null;
    focusCell(target.rowId, target.field);
  }, [focusCell, rows]);

  const load = useCallback(async () => {
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
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Failed to load products and tenant tax rates",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const insertRowAfter = useCallback((afterRowId?: string) => {
    const newRow = createEmptyRow(nextRowId.current++);
    setRows((current) => {
      if (!afterRowId) {
        return [...current, newRow];
      }
      const index = current.findIndex((row) => row.id === afterRowId);
      if (index < 0) {
        return [...current, newRow];
      }
      const next = [...current];
      next.splice(index + 1, 0, newRow);
      return next;
    });
    pendingFocus.current = { rowId: newRow.id, field: "sku" };
  }, []);

  const updateRow = useCallback((rowId: string, patch: Partial<DraftProductRow>) => {
    setRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
    setRowErrors((current) => {
      if (!current[rowId]) {
        return current;
      }
      const next = { ...current };
      next[rowId] = {};
      return next;
    });
  }, []);

  const handleUomChange = useCallback((rowId: string, nextValue: string) => {
    const uom = nextValue.toUpperCase();
    setRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) {
          return row;
        }
        if (row.quantity_precision_overridden) {
          return { ...row, uom };
        }
        return {
          ...row,
          uom,
          quantity_precision: String(inferQuantityPrecisionFromUom(uom)),
        };
      }),
    );
    setRowErrors((current) => {
      if (!current[rowId]) {
        return current;
      }
      const next = { ...current };
      next[rowId] = {};
      return next;
    });
  }, []);

  const handlePrecisionChange = useCallback((rowId: string, rawValue: string) => {
    const cleaned = rawValue.replace(/[^0-9]/g, "").slice(0, 1);
    setRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) {
          return row;
        }
        return {
          ...row,
          quantity_precision: cleaned,
          quantity_precision_overridden: true,
        };
      }),
    );
    setRowErrors((current) => {
      if (!current[rowId]) {
        return current;
      }
      const next = { ...current };
      next[rowId] = {};
      return next;
    });
  }, []);

  const removeRow = useCallback((rowId: string) => {
    setRows((current) => {
      if (current.length <= 1) {
        return [createEmptyRow(nextRowId.current++)];
      }
      return current.filter((row) => row.id !== rowId);
    });
    setRowErrors((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
  }, []);

  const duplicateRow = useCallback((source: DraftProductRow) => {
    const clone: DraftProductRow = {
      ...source,
      id: `product-row-${nextRowId.current++}`,
    };
    setRows((current) => {
      const index = current.findIndex((row) => row.id === source.id);
      if (index < 0) {
        return [...current, clone];
      }
      const next = [...current];
      next.splice(index + 1, 0, clone);
      return next;
    });
    pendingFocus.current = { rowId: clone.id, field: "sku" };
  }, []);

  const cancelRow = useCallback((rowId: string) => {
    setRows((current) => {
      if (current.length <= 1) {
        return [createEmptyRow(nextRowId.current++)];
      }
      return current.filter((row) => row.id !== rowId);
    });
    setRowErrors((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
  }, []);

  const mapErrorsToRows = useCallback(
    (
      errors: BulkImportError[],
      payloadToRowId: string[],
    ): Record<string, RowErrors> => {
      const nextErrors: Record<string, RowErrors> = {};
      for (const entry of errors) {
        const payloadIndex = entry.row - 1;
        const rowId = payloadToRowId[payloadIndex];
        if (!rowId) {
          continue;
        }
        if (!nextErrors[rowId]) {
          nextErrors[rowId] = {};
        }
        if (entry.field && entry.field in createEmptyRow(0)) {
          nextErrors[rowId][entry.field as GridField] = entry.message;
        } else if (!nextErrors[rowId].name) {
          nextErrors[rowId].name = entry.message;
        }
      }
      return nextErrors;
    },
    [],
  );

  const saveAll = useCallback(async () => {
    if (!canManage) {
      return;
    }

    setSaving(true);
    setError(null);
    setSummary(null);

    const candidateRows = rows.filter((row) => !isRowBlank(row));
    if (candidateRows.length === 0) {
      setSaving(false);
      setError("Add at least one product row to save.");
      return;
    }

    const validationErrors: Record<string, RowErrors> = {};
    const validRows: DraftProductRow[] = [];

    for (const row of candidateRows) {
      const errors = validateRow(row);
      if (row.gst_rate.trim()) {
        const normalizedRate = normalizeTaxRateValue(row.gst_rate.trim());
        if (!normalizedRate || !activeTaxRates.has(normalizedRate)) {
          errors.gst_rate = "Select an active GST rate";
        }
      }
      if (Object.keys(errors).length > 0) {
        validationErrors[row.id] = errors;
      } else {
        validRows.push(row);
      }
    }

    if (Object.keys(validationErrors).length > 0) {
      setRowErrors(validationErrors);
      setSaving(false);
      setError("Resolve inline validation errors before saving.");
      return;
    }

    const payloadRows: ProductPayload[] = validRows.map((row) => ({
      sku: row.sku.trim(),
      name: row.name.trim(),
      brand: row.brand.trim() || undefined,
      uom: row.uom.trim(),
      quantity_precision: normalizeQuantityPrecision(
        Number.parseInt(row.quantity_precision.trim() || "0", 10),
      ),
      barcode: row.barcode.trim() || undefined,
      hsn: row.hsn.trim() || undefined,
      gst_rate: row.gst_rate.trim() || undefined,
      is_active: row.is_active,
    }));

    try {
      const result = await apiClient.bulkCreateItems({ rows: payloadRows });
      const payloadToRowId = validRows.map((row) => row.id);
      const nextErrors = mapErrorsToRows(result.errors, payloadToRowId);
      setRowErrors(nextErrors);

      if (result.created_count > 0) {
        await load();
      }

      if (result.failed_count > 0) {
        const failedRowIds = new Set(
          result.errors
            .map((entry) => payloadToRowId[entry.row - 1])
            .filter((rowId): rowId is string => Boolean(rowId)),
        );
        const failedRows = validRows.filter((row) => failedRowIds.has(row.id));
        setRows(
          failedRows.length > 0
            ? [...failedRows, createEmptyRow(nextRowId.current++)]
            : [createEmptyRow(nextRowId.current++)],
        );
        setSummary(`Created ${result.created_count}, failed ${result.failed_count}.`);
      } else {
        setRows([createEmptyRow(nextRowId.current++)]);
        setSummary(`Created ${result.created_count} items successfully.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save items.");
    } finally {
      setSaving(false);
    }
  }, [activeTaxRates, canManage, load, mapErrorsToRows, rows]);

  const handleCellKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>, rowId: string) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void saveAll();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        insertRowAfter(rowId);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        cancelRow(rowId);
      }
    },
    [cancelRow, insertRowAfter, saveAll],
  );

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border bg-[hsl(var(--muted-bg))]">
          <CardTitle className="text-[hsl(var(--text-primary))]">Product Entry Grid</CardTitle>
          <p className="text-sm text-muted-foreground">
            Tab/Shift+Tab navigate, Enter adds row, Ctrl+Enter saves all, Esc cancels row.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 p-0">
          {error ? (
            <div className="mx-4 mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {error}
            </div>
          ) : null}
          {summary ? (
            <div className="mx-4 mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {summary}
            </div>
          ) : null}

          {!permissionsLoading && !canManage ? (
            <div className="px-4 pb-4 text-sm text-muted-foreground">
              You have read-only access. Master data changes are disabled for your role.
            </div>
          ) : (
            <>
              <div className="max-h-[520px] overflow-auto">
                <table className="min-w-[1650px] border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-[hsl(var(--table-header-bg))] text-[hsl(var(--text-secondary))]">
                    <tr>
                      {[
                        "#",
                        "SKU",
                        "Product Name",
                        "Brand",
                        "UOM",
                        "Qty Precision",
                        "Barcode",
                        "HSN",
                        "GST Rate",
                        "Status",
                        "Action",
                      ].map((header) => (
                        <th
                          key={header}
                          className="border-b border-slate-300/40 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em]"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => {
                      const errors = rowErrors[row.id] ?? {};
                      return (
                        <tr
                          key={row.id}
                          className={cn(
                            "border-b border-slate-200 align-top",
                            index % 2 === 0 ? "bg-white" : "bg-slate-50",
                            "hover:bg-sky-50",
                          )}
                        >
                          <td className="px-3 py-2 font-medium text-slate-600">{index + 1}</td>
                          <td className="px-3 py-2">
                            <Input
                              ref={(element) => registerCell(row.id, "sku", element)}
                              data-testid={index === 0 ? "product-sku" : undefined}
                              value={row.sku}
                              onChange={(event) =>
                                updateRow(row.id, { sku: event.target.value.toUpperCase() })
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className={cn("h-9", errors.sku && "border-rose-500")}
                            />
                            {errors.sku ? (
                              <p className="mt-1 text-xs text-rose-600">{errors.sku}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              ref={(element) => registerCell(row.id, "name", element)}
                              data-testid={index === 0 ? "product-name" : undefined}
                              value={row.name}
                              onChange={(event) =>
                                updateRow(row.id, { name: event.target.value })
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className={cn("h-9", errors.name && "border-rose-500")}
                            />
                            {errors.name ? (
                              <p className="mt-1 text-xs text-rose-600">{errors.name}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              ref={(element) => registerCell(row.id, "brand", element)}
                              value={row.brand}
                              onChange={(event) =>
                                updateRow(row.id, { brand: event.target.value })
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className="h-9"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              ref={(element) => registerCell(row.id, "uom", element)}
                              value={row.uom}
                              onChange={(event) =>
                                handleUomChange(row.id, event.target.value)
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className={cn("h-9", errors.uom && "border-rose-500")}
                            />
                            {errors.uom ? (
                              <p className="mt-1 text-xs text-rose-600">{errors.uom}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              ref={(element) =>
                                registerCell(row.id, "quantity_precision", element)
                              }
                              value={row.quantity_precision}
                              onChange={(event) =>
                                handlePrecisionChange(row.id, event.target.value)
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className={cn(
                                "h-9 text-right",
                                errors.quantity_precision && "border-rose-500",
                              )}
                              inputMode="numeric"
                            />
                            {errors.quantity_precision ? (
                              <p className="mt-1 text-xs text-rose-600">
                                {errors.quantity_precision}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              ref={(element) => registerCell(row.id, "barcode", element)}
                              value={row.barcode}
                              onChange={(event) =>
                                updateRow(row.id, { barcode: event.target.value })
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className="h-9"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              ref={(element) => registerCell(row.id, "hsn", element)}
                              value={row.hsn}
                              onChange={(event) =>
                                updateRow(row.id, {
                                  hsn: event.target.value.replace(/[^\d]/g, "").slice(0, 8),
                                })
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className={cn("h-9", errors.hsn && "border-rose-500")}
                            />
                            {errors.hsn ? (
                              <p className="mt-1 text-xs text-rose-600">{errors.hsn}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              ref={(element) => registerCell(row.id, "gst_rate", element)}
                              data-testid={index === 0 ? "product-gst-rate" : undefined}
                              value={row.gst_rate ? normalizeTaxRateValue(row.gst_rate) : ""}
                              onChange={(event) =>
                                updateRow(row.id, { gst_rate: event.target.value })
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className={cn(
                                "h-9 w-full rounded-xl border border-input bg-background px-2 text-sm",
                                errors.gst_rate && "border-rose-500",
                              )}
                            >
                              <option value="">Select GST</option>
                              {taxRateOptions.map((taxRate) => {
                                const normalized = normalizeTaxRateValue(taxRate.rate_percent);
                                return (
                                  <option key={taxRate.id} value={normalized}>
                                    {taxRate.label} ({normalized}%)
                                  </option>
                                );
                              })}
                            </select>
                            {errors.gst_rate ? (
                              <p className="mt-1 text-xs text-rose-600">{errors.gst_rate}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              ref={(element) => registerCell(row.id, "is_active", element)}
                              value={row.is_active ? "ACTIVE" : "INACTIVE"}
                              onChange={(event) =>
                                updateRow(row.id, {
                                  is_active: event.target.value === "ACTIVE",
                                })
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className="h-9 w-full rounded-xl border border-input bg-background px-2 text-sm"
                            >
                              <option value="ACTIVE">Active</option>
                              <option value="INACTIVE">Inactive</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => duplicateRow(row)}
                                aria-label={`Duplicate row ${index + 1}`}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-rose-500 hover:text-rose-600"
                                onClick={() => removeRow(row.id)}
                                aria-label={`Delete row ${index + 1}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <AppActionBar className="rounded-none border-0 border-t bg-transparent px-4 pb-4 pt-0 shadow-none">
                <Button type="button" variant="outline" onClick={() => insertRowAfter()}>
                  Add Row
                </Button>
                <Button
                  data-testid="create-product"
                  type="button"
                  onClick={() => void saveAll()}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save All Rows (Ctrl+Enter)"}
                </Button>
              </AppActionBar>
            </>
          )}
        </CardContent>
      </Card>

      <AppTable title="Saved Products" description="Existing product master records.">
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading products...</p>
          ) : (
            <Table>
              <TableHeader className="bg-[hsl(var(--table-header-bg))]">
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead>Qty Precision</TableHead>
                  <TableHead>HSN</TableHead>
                  <TableHead>GST</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.sku}</TableCell>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>{item.brand ?? "-"}</TableCell>
                    <TableCell>{item.uom}</TableCell>
                    <TableCell>{item.quantity_precision}</TableCell>
                    <TableCell>{item.hsn ?? "-"}</TableCell>
                    <TableCell>
                      {item.gst_rate
                        ? `${gstLabelByRate.get(
                            normalizeTaxRateValue(item.gst_rate),
                          ) ?? "GST"} (${normalizeTaxRateValue(item.gst_rate)}%)`
                        : "-"}
                    </TableCell>
                    <TableCell>{item.is_active ? "Active" : "Inactive"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </AppTable>
    </div>
  );
}
