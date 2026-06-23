"use client";

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Save, SquarePen, X } from "lucide-react";

import { usePermissions } from "@/components/auth/permission-provider";
import {
  AppActionBar,
  AppFormGrid,
  AppTable,
  AppTabs,
} from "@/components/erp/app-primitives";
import { FieldShell, FormSection, NativeSelect } from "@/components/masters/form-primitives";
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
  type Uom,
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

// GST-exclusive unit price backed out of a GST-inclusive MRP.
// Mirrors the backend (unit_price_from_mrp); a missing GST rate is treated as 0%.
function computeUnitPrice(mrp: string, gstRate: string): string {
  const mrpValue = Number.parseFloat(mrp);
  if (!Number.isFinite(mrpValue)) {
    return "";
  }
  const gstValue = Number.parseFloat(gstRate);
  const rate = Number.isFinite(gstValue) ? gstValue : 0;
  const divisor = 1 + rate / 100;
  if (divisor <= 0) {
    return "";
  }
  return (mrpValue / divisor).toFixed(2);
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
    display_name: form.display_name.trim() || null,
    brand: form.brand.trim() || undefined,
    category: form.category.trim() || null,
    uom: form.uom.trim(),
    hsn: form.hsn.trim() || null,
    gst_rate: form.gst_rate.trim() || null,
    default_warehouse_id: form.default_warehouse_id ? Number(form.default_warehouse_id) : null,
    rack_number: form.rack_number.trim() || null,
    default_purchase_rate: form.default_purchase_rate.trim() || null,
    default_sale_rate: form.default_sale_rate.trim() || null,
    mrp: form.mrp.trim() || null,
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

function AddManufacturerModal({
  open,
  existingNames,
  onClose,
  onCreated,
}: {
  open: boolean;
  existingNames: Set<string>;
  onClose: () => void;
  onCreated: (brand: Brand) => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Manufacturer name is required.");
      return;
    }
    if (existingNames.has(trimmed.toLowerCase())) {
      setError("A manufacturer with this name already exists.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await apiClient.createBrand({ name: trimmed });
      onCreated(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to add manufacturer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-manufacturer-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card-bg))] p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2
              id="add-manufacturer-title"
              className="text-lg font-semibold text-[hsl(var(--text-primary))]"
            >
              Add Manufacturer
            </h2>
            <p className="text-sm text-[hsl(var(--text-secondary))]">
              Create a new manufacturer without leaving the product form.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-[hsl(var(--text-secondary))] transition-colors hover:bg-[hsl(var(--muted-bg))] hover:text-[hsl(var(--text-primary))]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-2">
          <label
            htmlFor="new-manufacturer-name"
            className="text-sm font-medium text-[hsl(var(--text-primary))]"
          >
            Manufacturer Name
          </label>
          <Input
            id="new-manufacturer-name"
            data-testid="new-manufacturer-name"
            value={name}
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !saving) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="e.g. Cipla"
          />
          {error ? (
            <p className="text-xs text-rose-700 dark:text-rose-400">{error}</p>
          ) : null}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            data-testid="save-new-manufacturer"
          >
            {saving ? "Adding…" : "Add Manufacturer"}
          </Button>
        </div>
      </div>
    </div>
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
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [categoryFilterOptions, setCategoryFilterOptions] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [formTab, setFormTab] = useState<"tax" | "storage" | "commercial">("tax");
  const [form, setForm] = useState<ProductFormState>(createEmptyForm);
  const [formErrors, setFormErrors] = useState<ValidationErrors>({});
  const [gridRows, setGridRows] = useState<GridRow[]>([createEmptyGridRow(1)]);
  const [gridErrors, setGridErrors] = useState<Record<string, ValidationErrors>>({});
  const [inlineEditProductId, setInlineEditProductId] = useState<number | null>(null);
  const [inlineEditRow, setInlineEditRow] = useState<ProductFormState | null>(null);
  const [inlineEditErrors, setInlineEditErrors] = useState<ValidationErrors>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [decimalFilter, setDecimalFilter] = useState<"ALL" | "YES" | "NO">("ALL");
  const [savedProductsPage, setSavedProductsPage] = useState(1);
  const [savedProductsPageSize, setSavedProductsPageSize] = useState<number>(10);
  const [totalProducts, setTotalProducts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const nextGridId = useRef(2);
  const gridCellRefs = useRef<Record<string, HTMLElement | null>>({});
  const [manufacturerModalOpen, setManufacturerModalOpen] = useState(false);
  const manufacturerOnCreatedRef = useRef<((name: string) => void) | null>(null);

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
  const uomOptions = useMemo(
    () =>
      [...uoms]
        .filter((uom) => uom.is_active)
        .map((uom) => uom.name)
        .sort((left, right) => left.localeCompare(right)),
    [uoms],
  );
  // Keep a product's current UOM selectable even if it isn't in the active list.
  const uomChoices = (current: string): string[] => {
    const trimmed = current.trim();
    return trimmed && !uomOptions.includes(trimmed) ? [trimmed, ...uomOptions] : uomOptions;
  };
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
  const loadReferenceData = useCallback(async () => {
    const [taxRatesResult, brandsResult, warehousesResult, racksResult, categoriesResult, uomsResult] =
      await Promise.allSettled([
        apiClient.listTaxRates(false),
        apiClient.listBrands(false),
        apiClient.listWarehouses(false),
        apiClient.listRacks(),
        apiClient.listProductCategories(),
        apiClient.listUoms(false),
      ]);
    setTaxRates(taxRatesResult.status === "fulfilled" ? taxRatesResult.value : []);
    setBrands(brandsResult.status === "fulfilled" ? brandsResult.value : []);
    setWarehouses(warehousesResult.status === "fulfilled" ? warehousesResult.value : []);
    setRacks(racksResult.status === "fulfilled" ? racksResult.value : []);
    setCategoryFilterOptions(categoriesResult.status === "fulfilled" ? categoriesResult.value : []);
    setUoms(uomsResult.status === "fulfilled" ? uomsResult.value : []);
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.listProductsPage({
        search: debouncedSearch.trim() || undefined,
        brand: brandFilter || undefined,
        category: categoryFilter || undefined,
        default_warehouse_id: warehouseFilter || undefined,
        is_active:
          statusFilter === "ALL" ? undefined : statusFilter === "ACTIVE" ? true : false,
        decimal_allowed:
          decimalFilter === "ALL" ? undefined : decimalFilter === "YES" ? true : false,
        page: savedProductsPage,
        page_size: savedProductsPageSize,
      });
      setItems(response.data);
      setTotalProducts(response.total);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load Product Master");
      setItems([]);
      setTotalProducts(0);
    } finally {
      setLoading(false);
    }
  }, [
    debouncedSearch,
    brandFilter,
    categoryFilter,
    warehouseFilter,
    statusFilter,
    decimalFilter,
    savedProductsPage,
    savedProductsPageSize,
  ]);

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
    void loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const totalSavedProductPages = Math.max(1, Math.ceil(totalProducts / savedProductsPageSize));

  useEffect(() => {
    setSavedProductsPage(1);
  }, [debouncedSearch, brandFilter, categoryFilter, warehouseFilter, statusFilter, decimalFilter, savedProductsPageSize]);

  useEffect(() => {
    if (savedProductsPage > totalSavedProductPages) {
      setSavedProductsPage(totalSavedProductPages);
    }
  }, [savedProductsPage, totalSavedProductPages]);

  function updateFormField<K extends keyof ProductFormState>(field: K, value: ProductFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: undefined }));
  }

  function openAddManufacturer(onCreated: (name: string) => void) {
    manufacturerOnCreatedRef.current = onCreated;
    setManufacturerModalOpen(true);
  }

  function closeAddManufacturer() {
    manufacturerOnCreatedRef.current = null;
    setManufacturerModalOpen(false);
  }

  function handleManufacturerCreated(saved: Brand) {
    setBrands((current) =>
      current.some((brand) => brand.id === saved.id) ? current : [...current, saved],
    );
    manufacturerOnCreatedRef.current?.(saved.name);
    closeAddManufacturer();
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
      // Surface errors that live on a hidden tab by switching to it.
      if (nextErrors.default_purchase_rate || nextErrors.default_sale_rate || nextErrors.mrp) {
        setFormTab("commercial");
      } else if (nextErrors.default_warehouse_id || nextErrors.rack_number) {
        setFormTab("storage");
      } else if (nextErrors.hsn || nextErrors.gst_rate) {
        setFormTab("tax");
      }
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
      await Promise.all([loadProducts(), loadReferenceData()]);
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
      await Promise.all([loadProducts(), loadReferenceData()]);
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
      await Promise.all([loadProducts(), loadReferenceData()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to update product.");
    } finally {
      setSaving(false);
    }
  }

  const createProductForm = (
    <div className="space-y-6">
      {!permissionsLoading && !canManage ? (
        <FormSection
          title="Create Product"
          description="Set tax, storage, and commercial defaults in one product-first workspace."
          collapsible={false}
        >
          <p className="text-sm text-[hsl(var(--text-secondary))]">
            You have read-only access. Product master changes are disabled for your role.
          </p>
        </FormSection>
      ) : (
        <>
          <FormSection
            title="Product Details"
            description="Identify the product and map it to business-facing manufacturer and category labels."
          >
            <AppFormGrid className="xl:grid-cols-3">
              <FieldShell label="SKU" error={formErrors.sku}>
                <Input data-testid="product-sku" value={form.sku} onChange={(event) => updateFormField("sku", event.target.value.toUpperCase())} />
              </FieldShell>
              <FieldShell label="Product Name" error={formErrors.name}>
                <Input data-testid="product-name" value={form.name} onChange={(event) => updateFormField("name", event.target.value)} />
              </FieldShell>
              <FieldShell label="Display Name">
                <Input value={form.display_name} onChange={(event) => updateFormField("display_name", event.target.value)} />
              </FieldShell>
              <FieldShell label="Manufacturer" error={formErrors.brand}>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <NativeSelect
                      testId="product-brand"
                      value={form.brand}
                      onChange={(value) => updateFormField("brand", value)}
                    >
                      <option value="">Select manufacturer</option>
                      {brandOptions.map((brand) => (
                        <option key={brand.id} value={brand.name}>
                          {brand.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 shrink-0"
                    onClick={() =>
                      openAddManufacturer((name) => updateFormField("brand", name))
                    }
                    data-testid="add-manufacturer"
                    aria-label="Add manufacturer"
                  >
                    <Plus className="h-4 w-4" />
                    New
                  </Button>
                </div>
              </FieldShell>
              <FieldShell label="Category">
                <Input value={form.category} onChange={(event) => updateFormField("category", event.target.value)} placeholder="General Medicines" />
              </FieldShell>
              <FieldShell label="UOM" error={formErrors.uom}>
                <NativeSelect value={form.uom} onChange={(value) => updateFormField("uom", value)}>
                  <option value="">Select UOM</option>
                  {uomChoices(form.uom).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </NativeSelect>
              </FieldShell>
              <FieldShell label="Status">
                <NativeSelect
                  value={form.is_active ? "ACTIVE" : "INACTIVE"}
                  onChange={(value) => updateFormField("is_active", value === "ACTIVE")}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </NativeSelect>
              </FieldShell>
            </AppFormGrid>
          </FormSection>

          <AppTabs
            tabs={[
              { id: "tax", label: "Tax & Classification" },
              { id: "storage", label: "Storage & Inventory" },
              { id: "commercial", label: "Commercial Defaults" },
            ]}
            value={formTab}
            onChange={(value) => setFormTab(value as typeof formTab)}
          />

          {formTab === "tax" ? (
          <FormSection
            title="Tax & Classification"
            collapsible={false}
            description="Capture the GST and HSN setup used by procurement and billing."
          >
            <AppFormGrid className="xl:grid-cols-2">
              <FieldShell label="HSN Code" error={formErrors.hsn}>
                <Input value={form.hsn} onChange={(event) => updateFormField("hsn", event.target.value.replace(/[^\d]/g, "").slice(0, 8))} />
              </FieldShell>
              <FieldShell label="GST Rate" error={formErrors.gst_rate}>
                <NativeSelect
                  testId="product-gst-rate"
                  value={form.gst_rate}
                  onChange={(value) => updateFormField("gst_rate", value)}
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
                </NativeSelect>
              </FieldShell>
            </AppFormGrid>
          </FormSection>
          ) : null}

          {formTab === "storage" ? (
          <FormSection
            title="Storage & Inventory"
            collapsible={false}
            description="Operational hints for receiving and put-away, plus quantity behaviour."
          >
            <AppFormGrid className="xl:grid-cols-2">
              <FieldShell label="Default Warehouse" error={formErrors.default_warehouse_id}>
                <NativeSelect
                  value={form.default_warehouse_id}
                  onChange={(value) => updateFormField("default_warehouse_id", value)}
                >
                  <option value="">Select default warehouse</option>
                  {warehouseOptions.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </NativeSelect>
              </FieldShell>
              <FieldShell label="Rack Number" error={formErrors.rack_number}>
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
              </FieldShell>
              <FieldShell label="Decimal Allowed" hint="Use No for tablets, strips, boxes. Use Yes for kilo, litre, loose material.">
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
              </FieldShell>
            </AppFormGrid>
          </FormSection>
          ) : null}

          {formTab === "commercial" ? (
          <FormSection
            title="Commercial Defaults"
            collapsible={false}
            description="Save default rates so procurement and downstream documents start with sensible values."
          >
            <AppFormGrid className="xl:grid-cols-2">
              <FieldShell label="MRP" error={formErrors.mrp} hint="GST-inclusive maximum retail price.">
                <Input value={form.mrp} onChange={(event) => updateFormField("mrp", event.target.value)} />
              </FieldShell>
              <FieldShell label="Unit Price (ex-GST)" hint="Auto-calculated: MRP ÷ (1 + GST%).">
                <Input
                  data-testid="product-unit-price"
                  value={computeUnitPrice(form.mrp, form.gst_rate)}
                  readOnly
                  tabIndex={-1}
                  placeholder="—"
                  className="bg-[hsl(var(--muted-bg))]"
                />
              </FieldShell>
              <FieldShell label="Default Purchase Rate" error={formErrors.default_purchase_rate}>
                <Input value={form.default_purchase_rate} onChange={(event) => updateFormField("default_purchase_rate", event.target.value)} />
              </FieldShell>
              <FieldShell label="Default Sale Rate" error={formErrors.default_sale_rate}>
                <Input value={form.default_sale_rate} onChange={(event) => updateFormField("default_sale_rate", event.target.value)} />
              </FieldShell>
            </AppFormGrid>
          </FormSection>
          ) : null}

          <AppActionBar>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setForm(createEmptyForm());
                setFormTab("tax");
              }}
            >
              Clear
            </Button>
            <Button data-testid="create-product" type="button" onClick={() => void saveForm()} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Add Product"}
            </Button>
          </AppActionBar>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <AddManufacturerModal
        open={manufacturerModalOpen}
        existingNames={new Set(brands.map((brand) => brand.name.toLowerCase()))}
        onClose={closeAddManufacturer}
        onCreated={handleManufacturerCreated}
      />
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
                <TableHead>MRP</TableHead>
                <TableHead>Unit Price</TableHead>
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
                      <select
                        ref={(element) => registerGridCell(row.id, "uom", element)}
                        value={row.uom}
                        onChange={(event) => updateGridRow(row.id, "uom", event.target.value)}
                        onKeyDown={(event) => handleGridKeyDown(row.id, "uom", event)}
                        className={cn("h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground", rowErrors.uom && "border-rose-500")}
                      >
                        <option value="">Select UOM</option>
                        {uomChoices(row.uom).map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
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
                    <TableCell className="min-w-[120px]">
                      <Input
                        value={row.mrp}
                        onChange={(event) => updateGridRow(row.id, "mrp", event.target.value)}
                        placeholder="MRP"
                        className={cn(rowErrors.mrp && "border-rose-500")}
                      />
                      {rowErrors.mrp ? <p className="mt-1 text-xs text-rose-600">{rowErrors.mrp}</p> : null}
                    </TableCell>
                    <TableCell className="min-w-[120px]">
                      <Input
                        value={computeUnitPrice(row.mrp, row.gst_rate)}
                        readOnly
                        tabIndex={-1}
                        placeholder="—"
                        className="bg-[hsl(var(--muted-bg))]"
                      />
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
              {categoryFilterOptions.map((category) => (
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
                <TableHead>MRP</TableHead>
                <TableHead>Unit Price</TableHead>
                <TableHead>Default Warehouse</TableHead>
                <TableHead>Rack Number</TableHead>
                <TableHead>Decimal Allowed</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="py-10 text-center text-sm text-muted-foreground">
                    No products match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => {
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
                            <div className="flex items-center gap-1.5">
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
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-9 shrink-0 px-0"
                                onClick={() =>
                                  openAddManufacturer((name) =>
                                    updateInlineEditRow("brand", name),
                                  )
                                }
                                aria-label="Add manufacturer"
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
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
                            <select
                              value={inlineEditRow.uom}
                              onChange={(event) => updateInlineEditRow("uom", event.target.value)}
                              className={cn("h-9 w-full rounded-xl border border-input bg-background px-2 text-sm", inlineEditErrors.uom && "border-rose-500")}
                            >
                              <option value="">Select UOM</option>
                              {uomChoices(inlineEditRow.uom).map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
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
                      <TableCell className="min-w-[120px]">
                        {isEditing ? (
                          <>
                            <Input
                              value={inlineEditRow.mrp}
                              onChange={(event) => updateInlineEditRow("mrp", event.target.value)}
                              className={cn("h-9", inlineEditErrors.mrp && "border-rose-500")}
                            />
                            {inlineEditErrors.mrp ? <p className="mt-1 text-xs text-rose-600">{inlineEditErrors.mrp}</p> : null}
                          </>
                        ) : (
                          item.mrp ?? "-"
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {isEditing
                          ? computeUnitPrice(inlineEditRow.mrp, inlineEditRow.gst_rate) || "-"
                          : item.unit_price ?? "-"}
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
        {!loading && totalProducts > 0 ? (
          <div className="flex flex-col gap-3 border-t border-border px-4 py-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
            <span>
              Showing {(savedProductsPage - 1) * savedProductsPageSize + 1}
              {" - "}
              {Math.min(savedProductsPage * savedProductsPageSize, totalProducts)}
              {" of "}
              {totalProducts}
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
