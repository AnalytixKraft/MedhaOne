"use client";

import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Boxes, MapPinned, Plus, Save, SquarePen, Tag, X } from "lucide-react";

import { usePermissions } from "@/components/auth/permission-provider";
import {
  AppActionBar,
  AppFormGrid,
  AppSectionCard,
  AppTable,
  AppTabs,
} from "@/components/erp/app-primitives";
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
  type Brand,
  type Product,
  type ProductPayload,
  type Rack,
  type TaxRate,
  type Warehouse,
} from "@/lib/api/client";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

type ViewMode = "grid" | "form";

type ProductFormState = {
  sku: string;
  name: string;
  display_name: string;
  brand: string;
  category: string;
  uom: string;
  hsn: string;
  gst_rate: string;
  default_warehouse_id: string;
  rack_number: string;
  default_purchase_rate: string;
  default_sale_rate: string;
  mrp: string;
  decimal_allowed: boolean;
  is_active: boolean;
};

type ValidationErrors = Partial<Record<keyof ProductFormState, string>>;

type GridRow = ProductFormState & {
  id: string;
};

type GridField =
  | "sku"
  | "name"
  | "brand"
  | "category"
  | "uom"
  | "gst_rate"
  | "default_warehouse_id"
  | "rack_number";

const gridFieldOrder: GridField[] = [
  "sku",
  "name",
  "brand",
  "category",
  "uom",
  "gst_rate",
  "default_warehouse_id",
  "rack_number",
];

function normalizeTaxRateValue(value: string): string {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    return "";
  }
  return parsed.toFixed(2);
}

function createEmptyForm(): ProductFormState {
  return {
    sku: "",
    name: "",
    display_name: "",
    brand: "",
    category: "",
    uom: "EA",
    hsn: "",
    gst_rate: "",
    default_warehouse_id: "",
    rack_number: "",
    default_purchase_rate: "",
    default_sale_rate: "",
    mrp: "",
    decimal_allowed: false,
    is_active: true,
  };
}

function createEmptyGridRow(index: number): GridRow {
  return {
    id: `product-grid-${index}`,
    ...createEmptyForm(),
  };
}

function isGridRowBlank(row: GridRow) {
  return !(
    row.sku ||
    row.name ||
    row.brand ||
    row.category ||
    row.uom ||
    row.gst_rate ||
    row.default_warehouse_id ||
    row.rack_number
  );
}

function fromProduct(product: Product): ProductFormState {
  return {
    sku: product.sku,
    name: product.name,
    display_name: product.display_name ?? "",
    brand: product.brand ?? "",
    category: product.category ?? "",
    uom: product.uom,
    hsn: product.hsn ?? "",
    gst_rate: product.gst_rate ? normalizeTaxRateValue(product.gst_rate) : "",
    default_warehouse_id: product.default_warehouse_id ? String(product.default_warehouse_id) : "",
    rack_number: product.rack_number ?? "",
    default_purchase_rate: product.default_purchase_rate ?? "",
    default_sale_rate: product.default_sale_rate ?? "",
    mrp: product.mrp ?? "",
    decimal_allowed: product.decimal_allowed,
    is_active: product.is_active,
  };
}

function toProductPayload(form: ProductFormState): ProductPayload {
  return {
    sku: form.sku.trim(),
    name: form.name.trim(),
    display_name: form.display_name.trim() || undefined,
    brand: form.brand.trim() || undefined,
    category: form.category.trim() || undefined,
    uom: form.uom.trim(),
    hsn: form.hsn.trim() || undefined,
    gst_rate: form.gst_rate.trim() || undefined,
    default_warehouse_id: form.default_warehouse_id ? Number(form.default_warehouse_id) : null,
    rack_number: form.rack_number.trim() || undefined,
    default_purchase_rate: form.default_purchase_rate.trim() || undefined,
    default_sale_rate: form.default_sale_rate.trim() || undefined,
    mrp: form.mrp.trim() || undefined,
    decimal_allowed: form.decimal_allowed,
    is_active: form.is_active,
  };
}

function validateForm(
  form: ProductFormState,
  activeBrandNames: Set<string>,
  activeTaxRates: Set<string>,
  warehouseIds: Set<string>,
  rackNumbersByWarehouse: Map<string, Set<string>>,
): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!form.sku.trim()) {
    errors.sku = "SKU is required";
  }
  if (!form.name.trim()) {
    errors.name = "Product name is required";
  }
  if (!form.brand.trim()) {
    errors.brand = "Manufacturer is required";
  } else if (!activeBrandNames.has(form.brand.trim())) {
    errors.brand = "Manufacturer must exist in Master Settings";
  }
  if (!form.uom.trim()) {
    errors.uom = "UOM is required";
  }
  if (form.hsn.trim() && !/^\d{4,8}$/.test(form.hsn.trim())) {
    errors.hsn = "HSN must be 4 to 8 digits";
  }
  if (form.gst_rate.trim()) {
    const normalized = normalizeTaxRateValue(form.gst_rate.trim());
    if (!normalized || !activeTaxRates.has(normalized)) {
      errors.gst_rate = "Select an active GST rate";
    }
  }
  if (form.default_warehouse_id && !warehouseIds.has(form.default_warehouse_id)) {
    errors.default_warehouse_id = "Default warehouse must exist";
  }
  if (form.rack_number.trim()) {
    if (!form.default_warehouse_id) {
      errors.rack_number = "Select default warehouse before assigning a rack";
    } else {
      const rackOptions = rackNumbersByWarehouse.get(form.default_warehouse_id) ?? new Set<string>();
      if (!rackOptions.has(form.rack_number.trim().toLowerCase())) {
        errors.rack_number = "Rack must exist in the selected warehouse";
      }
    }
  }
  for (const field of ["default_purchase_rate", "default_sale_rate", "mrp"] as const) {
    const value = form[field].trim();
    if (value && !/^\d+(\.\d{1,2})?$/.test(value)) {
      errors[field] = "Enter a valid amount";
    }
  }
  return errors;
}

function SectionTone({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-200">
        {icon}
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-[hsl(var(--text-primary))]">{title}</h3>
        <p className="text-sm text-[hsl(var(--text-secondary))]">{description}</p>
      </div>
    </div>
  );
}

function ProductField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-2">
      <p className="text-sm font-medium text-[hsl(var(--text-primary))]">{label}</p>
      {children}
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </label>
  );
}

export function ProductsManager() {
  const { user, hasPermission, loading: permissionsLoading } = usePermissions();
  const canManage = !!user && (user.is_superuser || hasPermission("masters:manage"));

  const [items, setItems] = useState<Product[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [form, setForm] = useState<ProductFormState>(createEmptyForm);
  const [formErrors, setFormErrors] = useState<ValidationErrors>({});
  const [gridRows, setGridRows] = useState<GridRow[]>([createEmptyGridRow(1)]);
  const [gridErrors, setGridErrors] = useState<Record<string, ValidationErrors>>({});
  const [inlineEditProductId, setInlineEditProductId] = useState<number | null>(null);
  const [inlineEditRow, setInlineEditRow] = useState<ProductFormState | null>(null);
  const [inlineEditErrors, setInlineEditErrors] = useState<ValidationErrors>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [decimalFilter, setDecimalFilter] = useState<"ALL" | "YES" | "NO">("ALL");
  const [savedProductsPage, setSavedProductsPage] = useState(1);
  const [savedProductsPageSize, setSavedProductsPageSize] = useState<number>(10);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const nextGridId = useRef(2);
  const gridCellRefs = useRef<Record<string, HTMLElement | null>>({});

  const taxRateOptions = useMemo(
    () =>
      [...taxRates].sort(
        (left, right) =>
          Number.parseFloat(left.rate_percent) - Number.parseFloat(right.rate_percent),
      ),
    [taxRates],
  );
  const brandOptions = useMemo(
    () =>
      [...brands]
        .filter((brand) => brand.is_active)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [brands],
  );
  const warehouseOptions = useMemo(
    () =>
      [...warehouses]
        .filter((warehouse) => warehouse.is_active)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [warehouses],
  );
  const activeBrandNames = useMemo(
    () => new Set(brandOptions.map((brand) => brand.name)),
    [brandOptions],
  );
  const activeTaxRates = useMemo(
    () => new Set(taxRateOptions.map((taxRate) => normalizeTaxRateValue(taxRate.rate_percent))),
    [taxRateOptions],
  );
  const activeWarehouseIds = useMemo(
    () => new Set(warehouseOptions.map((warehouse) => String(warehouse.id))),
    [warehouseOptions],
  );
  const activeRackNumbersByWarehouse = useMemo(() => {
    const next = new Map<string, Set<string>>();
    for (const rack of racks) {
      if (!rack.is_active) {
        continue;
      }
      const warehouseId = String(rack.warehouse_id);
      const values = next.get(warehouseId) ?? new Set<string>();
      values.add(rack.rack_number.trim().toLowerCase());
      next.set(warehouseId, values);
    }
    return next;
  }, [racks]);
  const categoryOptions = useMemo(
    () =>
      Array.from(new Set(items.map((item) => item.category).filter((value): value is string => Boolean(value))))
        .sort((left, right) => left.localeCompare(right)),
    [items],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [productsResult, taxRatesResult, brandsResult, warehousesResult, racksResult] = await Promise.allSettled([
        apiClient.listProducts(),
        apiClient.listTaxRates(false),
        apiClient.listBrands(false),
        apiClient.listWarehouses(false),
        apiClient.listRacks(),
      ]);

      if (productsResult.status === "rejected") {
        throw productsResult.reason;
      }
      setItems(productsResult.value);
      setTaxRates(taxRatesResult.status === "fulfilled" ? taxRatesResult.value : []);
      setBrands(brandsResult.status === "fulfilled" ? brandsResult.value : []);
      setWarehouses(warehousesResult.status === "fulfilled" ? warehousesResult.value : []);
      setRacks(racksResult.status === "fulfilled" ? racksResult.value : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load Product Master");
    } finally {
      setLoading(false);
    }
  }, []);

  function getRackSuggestions(warehouseId: string, currentValue?: string | null): string[] {
    if (!warehouseId) {
      return currentValue?.trim() ? [currentValue.trim()] : [];
    }

    const rackSet = activeRackNumbersByWarehouse.get(warehouseId) ?? new Set<string>();
    const suggestions = racks
      .filter((rack) => rack.is_active && String(rack.warehouse_id) === warehouseId)
      .map((rack) => rack.rack_number)
      .sort((left, right) => left.localeCompare(right));

    if (currentValue?.trim() && !rackSet.has(currentValue.trim().toLowerCase())) {
      suggestions.unshift(currentValue.trim());
    }
    return Array.from(new Set(suggestions));
  }

  useEffect(() => {
    void load();
  }, [load]);

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return [...items]
      .filter((item) => {
        if (brandFilter && item.brand !== brandFilter) {
          return false;
        }
        if (categoryFilter && item.category !== categoryFilter) {
          return false;
        }
        if (warehouseFilter && String(item.default_warehouse_id ?? "") !== warehouseFilter) {
          return false;
        }
        if (statusFilter === "ACTIVE" && !item.is_active) {
          return false;
        }
        if (statusFilter === "INACTIVE" && item.is_active) {
          return false;
        }
        if (decimalFilter === "YES" && !item.decimal_allowed) {
          return false;
        }
        if (decimalFilter === "NO" && item.decimal_allowed) {
          return false;
        }
        if (!query) {
          return true;
        }
        return [
          item.sku,
          item.name,
          item.display_name ?? "",
          item.brand ?? "",
          item.category ?? "",
          item.default_warehouse_name ?? "",
          item.rack_number ?? "",
          item.gst_rate ?? "",
        ].some((value) => value.toLowerCase().includes(query));
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [items, searchQuery, brandFilter, categoryFilter, warehouseFilter, statusFilter, decimalFilter]);

  const totalSavedProductPages = Math.max(
    1,
    Math.ceil(filteredItems.length / savedProductsPageSize),
  );

  const paginatedItems = useMemo(() => {
    const startIndex = (savedProductsPage - 1) * savedProductsPageSize;
    return filteredItems.slice(startIndex, startIndex + savedProductsPageSize);
  }, [filteredItems, savedProductsPage, savedProductsPageSize]);

  useEffect(() => {
    setSavedProductsPage(1);
  }, [searchQuery, brandFilter, categoryFilter, warehouseFilter, statusFilter, decimalFilter, savedProductsPageSize]);

  useEffect(() => {
    if (savedProductsPage > totalSavedProductPages) {
      setSavedProductsPage(totalSavedProductPages);
    }
  }, [savedProductsPage, totalSavedProductPages]);

  function updateFormField<K extends keyof ProductFormState>(field: K, value: ProductFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: undefined }));
  }

  function ensureTrailingBlankRow(rows: GridRow[]) {
    if (rows.length === 0 || !isGridRowBlank(rows[rows.length - 1]!)) {
      return [...rows, createEmptyGridRow(nextGridId.current++)];
    }
    return rows;
  }

  function registerGridCell(rowId: string, field: GridField, element: HTMLElement | null) {
    gridCellRefs.current[`${rowId}:${field}`] = element;
  }

  function focusGridCell(rowId: string, field: GridField) {
    gridCellRefs.current[`${rowId}:${field}`]?.focus();
  }

  function addGridRow(afterRowId?: string) {
    const newRow = createEmptyGridRow(nextGridId.current++);
    setGridRows((current) => {
      if (!afterRowId) {
        return [...current, newRow];
      }
      const index = current.findIndex((row) => row.id === afterRowId);
      if (index === -1) {
        return [...current, newRow];
      }
      const next = [...current];
      next.splice(index + 1, 0, newRow);
      return next;
    });
    requestAnimationFrame(() => focusGridCell(newRow.id, "sku"));
  }

  function updateGridRow<K extends keyof ProductFormState>(
    rowId: string,
    field: K,
    value: ProductFormState[K],
  ) {
    setGridRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
    );
    setGridErrors((current) => ({
      ...current,
      [rowId]: { ...current[rowId], [field]: undefined },
    }));
  }

  function handleGridKeyDown(rowId: string, field: GridField, event: KeyboardEvent<HTMLElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void saveGridRows();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    const lastField = gridFieldOrder[gridFieldOrder.length - 1];
    if (field === lastField) {
      event.preventDefault();
      addGridRow(rowId);
    }
  }

  async function saveForm() {
    const nextErrors = validateForm(
      form,
      activeBrandNames,
      activeTaxRates,
      activeWarehouseIds,
      activeRackNumbersByWarehouse,
    );
    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSummary("Resolve the highlighted Product Master fields before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    setSummary(null);
    try {
      await apiClient.createProduct(toProductPayload(form));
      setForm(createEmptyForm());
      setSummary(`Created product ${form.sku.trim()}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to create product.");
    } finally {
      setSaving(false);
    }
  }

  async function saveGridRows() {
    const candidateRows = gridRows.filter((row) => !isGridRowBlank(row));
    const nextErrors: Record<string, ValidationErrors> = {};
    let hasErrors = false;

    for (const row of candidateRows) {
      const rowValidation = validateForm(
        row,
        activeBrandNames,
        activeTaxRates,
        activeWarehouseIds,
        activeRackNumbersByWarehouse,
      );
      if (Object.keys(rowValidation).length > 0) {
        nextErrors[row.id] = rowValidation;
        hasErrors = true;
      }
    }

    setGridErrors(nextErrors);
    if (hasErrors || candidateRows.length === 0) {
      setSummary("Fix the highlighted Product Master grid rows before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    setSummary(null);
    let createdCount = 0;
    const failedRows: GridRow[] = [];
    const failedErrors: Record<string, ValidationErrors> = {};

    try {
      for (const row of candidateRows) {
        try {
          await apiClient.createProduct(toProductPayload(row));
          createdCount += 1;
        } catch (caught) {
          failedRows.push(row);
          failedErrors[row.id] = {
            sku: caught instanceof Error ? caught.message : "Failed to create product.",
          };
        }
      }

      setGridErrors(failedErrors);
      setGridRows(
        failedRows.length > 0
          ? ensureTrailingBlankRow(failedRows)
          : [createEmptyGridRow(nextGridId.current++)],
      );
      setSummary(
        `Created ${createdCount} products${
          failedRows.length > 0 ? `, ${failedRows.length} failed.` : "."
        }`,
      );
      await load();
    } finally {
      setSaving(false);
    }
  }

  function beginInlineEdit(product: Product) {
    setInlineEditProductId(product.id);
    setInlineEditRow(fromProduct(product));
    setInlineEditErrors({});
    setSummary(null);
    setError(null);
  }

  function cancelInlineEdit() {
    setInlineEditProductId(null);
    setInlineEditRow(null);
    setInlineEditErrors({});
  }

  function updateInlineEditRow<K extends keyof ProductFormState>(
    field: K,
    value: ProductFormState[K],
  ) {
    setInlineEditRow((current) => (current ? { ...current, [field]: value } : current));
    setInlineEditErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function saveInlineEdit() {
    if (!canManage || inlineEditProductId === null || !inlineEditRow) {
      return;
    }

    const nextErrors = validateForm(
      inlineEditRow,
      activeBrandNames,
      activeTaxRates,
      activeWarehouseIds,
      activeRackNumbersByWarehouse,
    );
    setInlineEditErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setError("Resolve inline validation errors before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    setSummary(null);
    try {
      await apiClient.updateProduct(inlineEditProductId, toProductPayload(inlineEditRow));
      cancelInlineEdit();
      setSummary("Product updated.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to update product.");
    } finally {
      setSaving(false);
    }
  }

  const createProductForm = (
    <AppSectionCard className="overflow-hidden border-sky-200/70 dark:border-sky-900/60">
      <SectionTone
        icon={<Boxes className="h-5 w-5" />}
        title="Create Product"
        description="Set tax, storage, and commercial defaults in one product-first workspace."
      />

      {!permissionsLoading && !canManage ? (
        <p className="text-sm text-[hsl(var(--text-secondary))]">
          You have read-only access. Product master changes are disabled for your role.
        </p>
      ) : (
        <div className="space-y-6">
          <AppSectionCard title="Product Details" description="Identify the product and map it to business-facing manufacturer and category labels.">
            <AppFormGrid className="xl:grid-cols-3">
              <ProductField label="SKU" error={formErrors.sku}>
                <Input data-testid="product-sku" value={form.sku} onChange={(event) => updateFormField("sku", event.target.value.toUpperCase())} />
              </ProductField>
              <ProductField label="Product Name" error={formErrors.name}>
                <Input data-testid="product-name" value={form.name} onChange={(event) => updateFormField("name", event.target.value)} />
              </ProductField>
              <ProductField label="Display Name">
                <Input value={form.display_name} onChange={(event) => updateFormField("display_name", event.target.value)} />
              </ProductField>
              <ProductField label="Manufacturer" error={formErrors.brand}>
                <select
                  data-testid="product-brand"
                  value={form.brand}
                  onChange={(event) => updateFormField("brand", event.target.value)}
                  className={cn("h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-950", formErrors.brand && "border-rose-500")}
                >
                  <option value="">Select manufacturer</option>
                  {brandOptions.map((brand) => (
                    <option key={brand.id} value={brand.name}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </ProductField>
              <ProductField label="Category">
                <Input value={form.category} onChange={(event) => updateFormField("category", event.target.value)} placeholder="General Medicines" />
              </ProductField>
              <ProductField label="UOM" error={formErrors.uom}>
                <Input value={form.uom} onChange={(event) => updateFormField("uom", event.target.value.toUpperCase())} />
              </ProductField>
              <ProductField label="Status">
                <select
                  value={form.is_active ? "ACTIVE" : "INACTIVE"}
                  onChange={(event) => updateFormField("is_active", event.target.value === "ACTIVE")}
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-950"
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </ProductField>
            </AppFormGrid>
          </AppSectionCard>

          <AppSectionCard title="Tax & Classification" description="Capture the GST and HSN setup used by procurement and billing.">
            <AppFormGrid className="xl:grid-cols-2">
              <ProductField label="HSN Code" error={formErrors.hsn}>
                <Input value={form.hsn} onChange={(event) => updateFormField("hsn", event.target.value.replace(/[^\d]/g, "").slice(0, 8))} />
              </ProductField>
              <ProductField label="GST Rate" error={formErrors.gst_rate}>
                <select
                  data-testid="product-gst-rate"
                  value={form.gst_rate}
                  onChange={(event) => updateFormField("gst_rate", event.target.value)}
                  className={cn("h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-950", formErrors.gst_rate && "border-rose-500")}
                >
                  <option value="">Select GST rate</option>
                  {taxRateOptions.map((taxRate) => {
                    const normalized = normalizeTaxRateValue(taxRate.rate_percent);
                    return (
                      <option key={taxRate.id} value={normalized}>
                        {normalized}%
                      </option>
                    );
                  })}
                </select>
              </ProductField>
            </AppFormGrid>
          </AppSectionCard>

          <div className="grid gap-6 xl:grid-cols-[1.25fr,0.95fr]">
            <AppSectionCard title="Storage / Inventory Defaults" description="Suggest where the product usually belongs when it is received.">
              <SectionTone
                icon={<MapPinned className="h-5 w-5" />}
                title="Preferred storage context"
                description="These are operational hints for receiving and put-away, not warehouse restrictions."
              />
              <AppFormGrid className="xl:grid-cols-2">
                <ProductField label="Default Warehouse" error={formErrors.default_warehouse_id}>
                  <select
                    value={form.default_warehouse_id}
                    onChange={(event) => updateFormField("default_warehouse_id", event.target.value)}
                    className={cn("h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-950", formErrors.default_warehouse_id && "border-rose-500")}
                  >
                    <option value="">Select default warehouse</option>
                    {warehouseOptions.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </select>
                </ProductField>
                <ProductField label="Rack Number" error={formErrors.rack_number}>
                  <>
                    <Input
                      value={form.rack_number}
                      onChange={(event) => updateFormField("rack_number", event.target.value.toUpperCase())}
                      placeholder="Rack A-12"
                      list="product-form-rack-options"
                    />
                    <datalist id="product-form-rack-options">
                      {getRackSuggestions(form.default_warehouse_id, form.rack_number).map((rackNumber) => (
                        <option key={rackNumber} value={rackNumber} />
                      ))}
                    </datalist>
                  </>
                </ProductField>
              </AppFormGrid>
            </AppSectionCard>

            <AppSectionCard title="Quantity Behavior" description="Define whether this product accepts whole-number quantities only or decimal quantities.">
              <SectionTone
                icon={<Tag className="h-5 w-5" />}
                title="Decimal quantities"
                description="Use No for tablets, strips, boxes. Use Yes for kilo, litre, and loose material."
              />
              <ProductField label="Decimal Allowed">
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant={form.decimal_allowed ? "outline" : "default"}
                    onClick={() => updateFormField("decimal_allowed", false)}
                  >
                    No
                  </Button>
                  <Button
                    type="button"
                    variant={form.decimal_allowed ? "default" : "outline"}
                    onClick={() => updateFormField("decimal_allowed", true)}
                  >
                    Yes
                  </Button>
                </div>
              </ProductField>
            </AppSectionCard>
          </div>

          <AppSectionCard title="Commercial Defaults" description="Save default rates so procurement and downstream documents start with sensible values.">
            <AppFormGrid className="xl:grid-cols-3">
              <ProductField label="Default Purchase Rate" error={formErrors.default_purchase_rate}>
                <Input value={form.default_purchase_rate} onChange={(event) => updateFormField("default_purchase_rate", event.target.value)} />
              </ProductField>
              <ProductField label="Default Sale Rate" error={formErrors.default_sale_rate}>
                <Input value={form.default_sale_rate} onChange={(event) => updateFormField("default_sale_rate", event.target.value)} />
              </ProductField>
              <ProductField label="MRP" error={formErrors.mrp}>
                <Input value={form.mrp} onChange={(event) => updateFormField("mrp", event.target.value)} />
              </ProductField>
            </AppFormGrid>
          </AppSectionCard>

          <AppActionBar>
            <Button type="button" variant="outline" onClick={() => setForm(createEmptyForm())}>
              Clear
            </Button>
            <Button data-testid="create-product" type="button" onClick={() => void saveForm()} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Add Product"}
            </Button>
          </AppActionBar>
        </div>
      )}
    </AppSectionCard>
  );

  return (
    <div className="space-y-6">
      <AppTabs
        tabs={[
          { id: "grid", label: "Grid View" },
          { id: "form", label: "Form View" },
        ]}
        value={viewMode}
        onChange={(value) => setViewMode(value as ViewMode)}
      />

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {summary ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{summary}</p> : null}

      {viewMode === "form" ? (
        createProductForm
      ) : (
        <AppTable
          title="Product Master Grid"
          description="Bulk create products with operational defaults. Press Enter on the last editable cell to add a row, and Ctrl+Enter to save all rows."
          actions={
            <>
              <Button type="button" variant="outline" onClick={() => addGridRow()}>
                <Plus className="mr-2 h-4 w-4" />
                Add Row
              </Button>
              <Button type="button" onClick={() => void saveGridRows()} disabled={!canManage || saving}>
                <Save className="mr-2 h-4 w-4" />
                Save Rows
              </Button>
            </>
          }
        >
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-900">
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Product Name</TableHead>
                <TableHead>Manufacturer</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>UOM</TableHead>
                <TableHead>GST %</TableHead>
                <TableHead>Default Warehouse</TableHead>
                <TableHead>Rack Number</TableHead>
                <TableHead>Decimal Allowed</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gridRows.map((row, index) => {
                const rowErrors = gridErrors[row.id] ?? {};
                return (
                  <TableRow key={row.id} className="align-top">
                    <TableCell>{index + 1}</TableCell>
                    <TableCell className="min-w-[180px]">
                      <Input
                        ref={(element) => registerGridCell(row.id, "sku", element)}
                        value={row.sku}
                        onChange={(event) => updateGridRow(row.id, "sku", event.target.value.toUpperCase())}
                        onKeyDown={(event) => handleGridKeyDown(row.id, "sku", event)}
                        className={cn(rowErrors.sku && "border-rose-500")}
                      />
                      {rowErrors.sku ? <p className="mt-1 text-xs text-rose-600">{rowErrors.sku}</p> : null}
                    </TableCell>
                    <TableCell className="min-w-[220px]">
                      <Input
                        ref={(element) => registerGridCell(row.id, "name", element)}
                        value={row.name}
                        onChange={(event) => updateGridRow(row.id, "name", event.target.value)}
                        onKeyDown={(event) => handleGridKeyDown(row.id, "name", event)}
                        className={cn(rowErrors.name && "border-rose-500")}
                      />
                      {rowErrors.name ? <p className="mt-1 text-xs text-rose-600">{rowErrors.name}</p> : null}
                    </TableCell>
                    <TableCell className="min-w-[170px]">
                      <select
                        ref={(element) => registerGridCell(row.id, "brand", element)}
                        value={row.brand}
                        onChange={(event) => updateGridRow(row.id, "brand", event.target.value)}
                        onKeyDown={(event) => handleGridKeyDown(row.id, "brand", event)}
                        className={cn("h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground", rowErrors.brand && "border-rose-500")}
                      >
                        <option value="">Select manufacturer</option>
                        {brandOptions.map((brand) => (
                          <option key={brand.id} value={brand.name}>
                            {brand.name}
                          </option>
                        ))}
                      </select>
                      {rowErrors.brand ? <p className="mt-1 text-xs text-rose-600">{rowErrors.brand}</p> : null}
                    </TableCell>
                    <TableCell className="min-w-[170px]">
                      <Input
                        ref={(element) => registerGridCell(row.id, "category", element)}
                        value={row.category}
                        onChange={(event) => updateGridRow(row.id, "category", event.target.value)}
                        onKeyDown={(event) => handleGridKeyDown(row.id, "category", event)}
                      />
                    </TableCell>
                    <TableCell className="min-w-[120px]">
                      <Input
                        ref={(element) => registerGridCell(row.id, "uom", element)}
                        value={row.uom}
                        onChange={(event) => updateGridRow(row.id, "uom", event.target.value.toUpperCase())}
                        onKeyDown={(event) => handleGridKeyDown(row.id, "uom", event)}
                        className={cn(rowErrors.uom && "border-rose-500")}
                      />
                      {rowErrors.uom ? <p className="mt-1 text-xs text-rose-600">{rowErrors.uom}</p> : null}
                    </TableCell>
                    <TableCell className="min-w-[140px]">
                      <select
                        ref={(element) => registerGridCell(row.id, "gst_rate", element)}
                        value={row.gst_rate}
                        onChange={(event) => updateGridRow(row.id, "gst_rate", event.target.value)}
                        onKeyDown={(event) => handleGridKeyDown(row.id, "gst_rate", event)}
                        className={cn("h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground", rowErrors.gst_rate && "border-rose-500")}
                      >
                        <option value="">Select GST</option>
                        {taxRateOptions.map((taxRate) => {
                          const normalized = normalizeTaxRateValue(taxRate.rate_percent);
                          return (
                            <option key={taxRate.id} value={normalized}>
                              {normalized}%
                            </option>
                          );
                        })}
                      </select>
                      {rowErrors.gst_rate ? <p className="mt-1 text-xs text-rose-600">{rowErrors.gst_rate}</p> : null}
                    </TableCell>
                    <TableCell className="min-w-[180px]">
                      <select
                        ref={(element) => registerGridCell(row.id, "default_warehouse_id", element)}
                        value={row.default_warehouse_id}
                        onChange={(event) => updateGridRow(row.id, "default_warehouse_id", event.target.value)}
                        onKeyDown={(event) => handleGridKeyDown(row.id, "default_warehouse_id", event)}
                        className={cn("h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground", rowErrors.default_warehouse_id && "border-rose-500")}
                      >
                        <option value="">Select warehouse</option>
                        {warehouseOptions.map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>
                            {warehouse.name}
                          </option>
                        ))}
                      </select>
                      {rowErrors.default_warehouse_id ? <p className="mt-1 text-xs text-rose-600">{rowErrors.default_warehouse_id}</p> : null}
                    </TableCell>
                    <TableCell className="min-w-[140px]">
                      <>
                        <Input
                          ref={(element) => registerGridCell(row.id, "rack_number", element)}
                          value={row.rack_number}
                          onChange={(event) => updateGridRow(row.id, "rack_number", event.target.value.toUpperCase())}
                          onKeyDown={(event) => handleGridKeyDown(row.id, "rack_number", event)}
                          list={`product-grid-rack-options-${row.id}`}
                        />
                        <datalist id={`product-grid-rack-options-${row.id}`}>
                          {getRackSuggestions(row.default_warehouse_id, row.rack_number).map((rackNumber) => (
                            <option key={rackNumber} value={rackNumber} />
                          ))}
                        </datalist>
                      </>
                      {rowErrors.rack_number ? <p className="mt-1 text-xs text-rose-600">{rowErrors.rack_number}</p> : null}
                    </TableCell>
                    <TableCell className="min-w-[140px]">
                      <select
                        value={row.decimal_allowed ? "YES" : "NO"}
                        onChange={(event) => updateGridRow(row.id, "decimal_allowed", event.target.value === "YES")}
                        className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground"
                      >
                        <option value="NO">No</option>
                        <option value="YES">Yes</option>
                      </select>
                    </TableCell>
                    <TableCell className="min-w-[120px]">
                      <select
                        value={row.is_active ? "ACTIVE" : "INACTIVE"}
                        onChange={(event) => updateGridRow(row.id, "is_active", event.target.value === "ACTIVE")}
                        className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground"
                      >
                        <option value="ACTIVE">Active</option>
                        <option value="INACTIVE">Inactive</option>
                      </select>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </AppTable>
      )}

      <AppTable
        title="Saved Products"
        description="Search products and maintain operational defaults inline."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by SKU, product, manufacturer, category, rack"
              className="min-w-[280px]"
            />
            <select
              value={brandFilter}
              onChange={(event) => setBrandFilter(event.target.value)}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">All manufacturers</option>
              {brandOptions.map((brand) => (
                <option key={brand.id} value={brand.name}>
                  {brand.name}
                </option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">All categories</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <select
              value={warehouseFilter}
              onChange={(event) => setWarehouseFilter(event.target.value)}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">All warehouses</option>
              {warehouseOptions.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="ALL">All status</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
            <select
              value={decimalFilter}
              onChange={(event) => setDecimalFilter(event.target.value as typeof decimalFilter)}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="ALL">All quantity modes</option>
              <option value="YES">Decimal allowed</option>
              <option value="NO">Whole numbers only</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Rows</span>
              <select
                value={savedProductsPageSize}
                onChange={(event) => setSavedProductsPageSize(Number(event.target.value))}
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
      >
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading products...</p>
        ) : (
          <Table>
            <TableHeader className="bg-[hsl(var(--table-header-bg))]">
              <TableRow>
                <TableHead className="sticky left-0 z-10 bg-[hsl(var(--table-header-bg))]">Action</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Product Name</TableHead>
                <TableHead>Manufacturer</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>UOM</TableHead>
                <TableHead>GST</TableHead>
                <TableHead>Default Warehouse</TableHead>
                <TableHead>Rack Number</TableHead>
                <TableHead>Decimal Allowed</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-10 text-center text-sm text-muted-foreground">
                    No products match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedItems.map((item) => {
                  const isEditing = inlineEditProductId === item.id && inlineEditRow !== null;

                  return (
                    <TableRow key={item.id} className="align-top">
                      <TableCell className="sticky left-0 z-[1] min-w-[92px] bg-white dark:bg-slate-950">
                        <div className="flex items-center gap-2">
                          {isEditing ? (
                            <>
                              <Button
                                type="button"
                                size="icon"
                                onClick={() => void saveInlineEdit()}
                                disabled={!canManage || saving}
                                aria-label="Save product"
                                title="Save"
                              >
                                <Save className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                onClick={cancelInlineEdit}
                                disabled={saving}
                                aria-label="Cancel edit"
                                title="Cancel"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              onClick={() => beginInlineEdit(item)}
                              disabled={!canManage || saving}
                              aria-label="Edit product"
                              title="Edit"
                            >
                              <SquarePen className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <>
                            <Input
                              value={inlineEditRow.sku}
                              onChange={(event) => updateInlineEditRow("sku", event.target.value.toUpperCase())}
                              className={cn("h-9", inlineEditErrors.sku && "border-rose-500")}
                            />
                            {inlineEditErrors.sku ? <p className="mt-1 text-xs text-rose-600">{inlineEditErrors.sku}</p> : null}
                          </>
                        ) : (
                          item.sku
                        )}
                      </TableCell>
                      <TableCell className="min-w-[220px]">
                        {isEditing ? (
                          <div className="space-y-2">
                            <Input
                              value={inlineEditRow.name}
                              onChange={(event) => updateInlineEditRow("name", event.target.value)}
                              className={cn("h-9", inlineEditErrors.name && "border-rose-500")}
                            />
                            <Input
                              value={inlineEditRow.display_name}
                              onChange={(event) => updateInlineEditRow("display_name", event.target.value)}
                              placeholder="Display name"
                              className="h-9"
                            />
                            {inlineEditErrors.name ? <p className="text-xs text-rose-600">{inlineEditErrors.name}</p> : null}
                          </div>
                        ) : (
                          <div>
                            <p className="font-medium text-[hsl(var(--text-primary))]">{item.name}</p>
                            <p className="text-xs text-[hsl(var(--text-secondary))]">{item.display_name ?? "-"}</p>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <>
                            <select
                              value={inlineEditRow.brand}
                              onChange={(event) => updateInlineEditRow("brand", event.target.value)}
                              className={cn("h-9 w-full rounded-xl border border-input bg-background px-2 text-sm", inlineEditErrors.brand && "border-rose-500")}
                            >
                              <option value="">Select Manufacturer</option>
                              {brandOptions.map((brand) => (
                                <option key={brand.id} value={brand.name}>
                                  {brand.name}
                                </option>
                              ))}
                            </select>
                            {inlineEditErrors.brand ? <p className="mt-1 text-xs text-rose-600">{inlineEditErrors.brand}</p> : null}
                          </>
                        ) : (
                          item.brand ?? "-"
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input value={inlineEditRow.category} onChange={(event) => updateInlineEditRow("category", event.target.value)} className="h-9" />
                        ) : (
                          item.category ?? "-"
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <>
                            <Input value={inlineEditRow.uom} onChange={(event) => updateInlineEditRow("uom", event.target.value.toUpperCase())} className={cn("h-9", inlineEditErrors.uom && "border-rose-500")} />
                            {inlineEditErrors.uom ? <p className="mt-1 text-xs text-rose-600">{inlineEditErrors.uom}</p> : null}
                          </>
                        ) : (
                          item.uom
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <>
                            <select
                              value={inlineEditRow.gst_rate}
                              onChange={(event) => updateInlineEditRow("gst_rate", event.target.value)}
                              className={cn("h-9 w-full rounded-xl border border-input bg-background px-2 text-sm", inlineEditErrors.gst_rate && "border-rose-500")}
                            >
                              <option value="">Select GST</option>
                              {taxRateOptions.map((taxRate) => {
                                const normalized = normalizeTaxRateValue(taxRate.rate_percent);
                                return (
                                  <option key={taxRate.id} value={normalized}>
                                    {normalized}%
                                  </option>
                                );
                              })}
                            </select>
                            {inlineEditErrors.gst_rate ? <p className="mt-1 text-xs text-rose-600">{inlineEditErrors.gst_rate}</p> : null}
                          </>
                        ) : item.gst_rate ? (
                          `${normalizeTaxRateValue(item.gst_rate)}%`
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="min-w-[170px]">
                        {isEditing ? (
                          <>
                            <select
                              value={inlineEditRow.default_warehouse_id}
                              onChange={(event) => updateInlineEditRow("default_warehouse_id", event.target.value)}
                              className={cn("h-9 w-full rounded-xl border border-input bg-background px-2 text-sm", inlineEditErrors.default_warehouse_id && "border-rose-500")}
                            >
                              <option value="">Select warehouse</option>
                              {warehouseOptions.map((warehouse) => (
                                <option key={warehouse.id} value={warehouse.id}>
                                  {warehouse.name}
                                </option>
                              ))}
                            </select>
                            {inlineEditErrors.default_warehouse_id ? <p className="mt-1 text-xs text-rose-600">{inlineEditErrors.default_warehouse_id}</p> : null}
                          </>
                        ) : (
                          item.default_warehouse_name ?? "-"
                        )}
                      </TableCell>
                      <TableCell className="min-w-[140px]">
                        {isEditing ? (
                          <>
                            <Input
                              value={inlineEditRow.rack_number}
                              onChange={(event) => updateInlineEditRow("rack_number", event.target.value.toUpperCase())}
                              className="h-9"
                              list={`product-inline-rack-options-${item.id}`}
                            />
                            <datalist id={`product-inline-rack-options-${item.id}`}>
                              {getRackSuggestions(inlineEditRow.default_warehouse_id, inlineEditRow.rack_number).map((rackNumber) => (
                                <option key={rackNumber} value={rackNumber} />
                              ))}
                            </datalist>
                            {inlineEditErrors.rack_number ? <p className="mt-1 text-xs text-rose-600">{inlineEditErrors.rack_number}</p> : null}
                          </>
                        ) : (
                          item.rack_number ?? "-"
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <select
                            value={inlineEditRow.decimal_allowed ? "YES" : "NO"}
                            onChange={(event) => updateInlineEditRow("decimal_allowed", event.target.value === "YES")}
                            className="h-9 w-full rounded-xl border border-input bg-background px-2 text-sm"
                          >
                            <option value="NO">No</option>
                            <option value="YES">Yes</option>
                          </select>
                        ) : item.decimal_allowed ? (
                          "Yes"
                        ) : (
                          "No"
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <select
                            value={inlineEditRow.is_active ? "ACTIVE" : "INACTIVE"}
                            onChange={(event) => updateInlineEditRow("is_active", event.target.value === "ACTIVE")}
                            className="h-9 w-full rounded-xl border border-input bg-background px-2 text-sm"
                          >
                            <option value="ACTIVE">Active</option>
                            <option value="INACTIVE">Inactive</option>
                          </select>
                        ) : item.is_active ? (
                          "Active"
                      ) : (
                          "Inactive"
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
        {!loading && filteredItems.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-border px-4 py-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
            <span>
              Showing {(savedProductsPage - 1) * savedProductsPageSize + 1}
              {" - "}
              {Math.min(savedProductsPage * savedProductsPageSize, filteredItems.length)}
              {" of "}
              {filteredItems.length}
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setSavedProductsPage((current) => Math.max(1, current - 1))} disabled={savedProductsPage === 1}>
                Previous
              </Button>
              <span className="min-w-24 text-center">
                Page {savedProductsPage} of {totalSavedProductPages}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => setSavedProductsPage((current) => Math.min(totalSavedProductPages, current + 1))} disabled={savedProductsPage >= totalSavedProductPages}>
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </AppTable>
    </div>
  );
}
