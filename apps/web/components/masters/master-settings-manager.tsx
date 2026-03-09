"use client";

import { useEffect, useMemo, useState } from "react";
import { Landmark, Loader2, ReceiptText, Tags, type LucideIcon } from "lucide-react";

import { AppSectionCard, AppTabs } from "@/components/erp/app-primitives";
import { usePermissions } from "@/components/auth/permission-provider";
import { Button } from "@/components/ui/button";
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
  type BrandPayload,
  type Category,
  type CategoryPayload,
  type TaxRate,
  type TaxRatePayload,
} from "@/lib/api/client";

type MasterSettingsTab = "gst" | "brands" | "tds-tcs" | "categories";

type TaxRateFormState = {
  code: string;
  label: string;
  rate_percent: string;
  is_active: boolean;
};

type CategoryFormState = {
  name: string;
  is_active: boolean;
};

type BrandFormState = {
  name: string;
  is_active: boolean;
};

const tabs: Array<{ id: MasterSettingsTab; label: string }> = [
  { id: "gst", label: "GST" },
  { id: "brands", label: "Brands" },
  { id: "tds-tcs", label: "TDS / TCS" },
  { id: "categories", label: "Party Categories" },
];

const emptyTaxRateForm: TaxRateFormState = {
  code: "",
  label: "",
  rate_percent: "",
  is_active: true,
};

const emptyCategoryForm: CategoryFormState = {
  name: "",
  is_active: true,
};

const emptyBrandForm: BrandFormState = {
  name: "",
  is_active: true,
};

export function MasterSettingsManager({
  initialTab = "gst",
}: {
  initialTab?: MasterSettingsTab;
}) {
  const { user, hasPermission } = usePermissions();
  const [activeTab, setActiveTab] = useState<MasterSettingsTab>(initialTab);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [taxesLoading, setTaxesLoading] = useState(true);
  const [savingTaxRate, setSavingTaxRate] = useState(false);
  const [taxRateForm, setTaxRateForm] = useState<TaxRateFormState>(emptyTaxRateForm);
  const [taxRateFormTouched, setTaxRateFormTouched] = useState(false);
  const [editingTaxRateId, setEditingTaxRateId] = useState<number | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryForm, setCategoryForm] = useState<CategoryFormState>(emptyCategoryForm);
  const [categoryFormTouched, setCategoryFormTouched] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [savingBrand, setSavingBrand] = useState(false);
  const [brandForm, setBrandForm] = useState<BrandFormState>(emptyBrandForm);
  const [brandFormTouched, setBrandFormTouched] = useState(false);
  const [editingBrandId, setEditingBrandId] = useState<number | null>(null);

  const isOrgAdmin =
    !!user &&
    (user.role?.name === "ORG_ADMIN" || user.roles.some((role) => role.name === "ORG_ADMIN"));
  const canViewGst = !!user && (user.is_superuser || isOrgAdmin || hasPermission("tax:view"));
  const canManageGst = !!user && (user.is_superuser || isOrgAdmin || hasPermission("tax:manage"));
  const canViewCategories = !!user && (user.is_superuser || hasPermission("masters:view"));
  const canManageCategories = !!user && (user.is_superuser || hasPermission("masters:manage"));

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setTaxesLoading(true);
      setCategoriesLoading(true);
      setBrandsLoading(true);
      try {
        const [taxesResult, categoriesResult, brandsResult] = await Promise.allSettled([
          canViewGst ? apiClient.listTaxRates(true) : Promise.resolve([] as TaxRate[]),
          canViewCategories ? apiClient.listCategories(true) : Promise.resolve([] as Category[]),
          canViewCategories ? apiClient.listBrands(true) : Promise.resolve([] as Brand[]),
        ]);

        if (cancelled) {
          return;
        }

        if (taxesResult.status === "fulfilled") {
          setTaxRates(taxesResult.value);
        } else {
          setTaxRates([]);
          setError(taxesResult.reason instanceof Error ? taxesResult.reason.message : "Failed to load GST rates");
        }

        if (categoriesResult.status === "fulfilled") {
          setCategories(categoriesResult.value);
        } else {
          setCategories([]);
          setError(
            categoriesResult.reason instanceof Error
              ? categoriesResult.reason.message
              : "Failed to load categories",
          );
        }

        if (brandsResult.status === "fulfilled") {
          setBrands(brandsResult.value);
        } else {
          setBrands([]);
          setError(
            brandsResult.reason instanceof Error ? brandsResult.reason.message : "Failed to load brands",
          );
        }
      } finally {
        if (!cancelled) {
          setTaxesLoading(false);
          setCategoriesLoading(false);
          setBrandsLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [canViewCategories, canViewGst]);

  const activeTaxRatesCount = useMemo(
    () => taxRates.filter((taxRate) => taxRate.is_active).length,
    [taxRates],
  );

  const activeCategoriesCount = useMemo(
    () => categories.filter((category) => category.is_active).length,
    [categories],
  );

  const activeBrandsCount = useMemo(
    () => brands.filter((brand) => brand.is_active).length,
    [brands],
  );

  const taxRateFormErrors = useMemo(() => {
    const errors: Partial<Record<keyof TaxRateFormState, string>> = {};
    if (!taxRateForm.code.trim()) {
      errors.code = "Code is required.";
    }
    if (!taxRateForm.label.trim()) {
      errors.label = "Label is required.";
    }
    const rateValue = Number.parseFloat(taxRateForm.rate_percent);
    if (Number.isNaN(rateValue) || rateValue < 0 || rateValue > 100) {
      errors.rate_percent = "Enter a GST percent between 0 and 100.";
    }
    if (
      !errors.rate_percent &&
      taxRateForm.is_active &&
      taxRates.some(
        (rateRecord) =>
          rateRecord.id !== editingTaxRateId &&
          rateRecord.is_active &&
          Number.parseFloat(rateRecord.rate_percent) === rateValue,
      )
    ) {
      errors.rate_percent = "An active GST rate with this percent already exists.";
    }
    return errors;
  }, [editingTaxRateId, taxRateForm, taxRates]);

  const categoryFormErrors = useMemo(() => {
    const errors: Partial<Record<keyof CategoryFormState, string>> = {};
    if (!categoryForm.name.trim()) {
      errors.name = "Category name is required.";
    }
    if (
      categoryForm.name.trim() &&
      categories.some(
        (category) =>
          category.id !== editingCategoryId &&
          category.name.trim().toLowerCase() === categoryForm.name.trim().toLowerCase(),
      )
    ) {
      errors.name = "Category already exists.";
    }
    return errors;
  }, [categories, categoryForm.name, editingCategoryId]);

  const brandFormErrors = useMemo(() => {
    const errors: Partial<Record<keyof BrandFormState, string>> = {};
    if (!brandForm.name.trim()) {
      errors.name = "Brand name is required.";
    }
    if (
      brandForm.name.trim() &&
      brands.some(
        (brand) =>
          brand.id !== editingBrandId &&
          brand.name.trim().toLowerCase() === brandForm.name.trim().toLowerCase(),
      )
    ) {
      errors.name = "Brand already exists.";
    }
    return errors;
  }, [brandForm.name, brands, editingBrandId]);

  const taxRateFormIsValid = Object.keys(taxRateFormErrors).length === 0;
  const categoryFormIsValid = Object.keys(categoryFormErrors).length === 0;
  const brandFormIsValid = Object.keys(brandFormErrors).length === 0;

  const resetTaxRateForm = () => {
    setTaxRateForm(emptyTaxRateForm);
    setTaxRateFormTouched(false);
    setEditingTaxRateId(null);
  };

  const resetCategoryForm = () => {
    setCategoryForm(emptyCategoryForm);
    setCategoryFormTouched(false);
    setEditingCategoryId(null);
  };

  const resetBrandForm = () => {
    setBrandForm(emptyBrandForm);
    setBrandFormTouched(false);
    setEditingBrandId(null);
  };

  const handleSaveTaxRate = async () => {
    setTaxRateFormTouched(true);
    if (!canManageGst || !taxRateFormIsValid) {
      return;
    }

    setError(null);
    setSavingTaxRate(true);

    const payload: TaxRatePayload = {
      code: taxRateForm.code.trim().toUpperCase(),
      label: taxRateForm.label.trim(),
      rate_percent: Number.parseFloat(taxRateForm.rate_percent),
      is_active: taxRateForm.is_active,
    };

    try {
      const saved = editingTaxRateId
        ? await apiClient.updateTaxRate(editingTaxRateId, payload)
        : await apiClient.createTaxRate(payload);
      setTaxRates((current) => {
        if (editingTaxRateId) {
          return current.map((item) => (item.id === saved.id ? saved : item));
        }
        return [...current, saved];
      });
      setToast(editingTaxRateId ? "GST updated" : "GST added");
      resetTaxRateForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save GST");
    } finally {
      setSavingTaxRate(false);
    }
  };

  const handleEditTaxRate = (taxRate: TaxRate) => {
    setEditingTaxRateId(taxRate.id);
    setTaxRateFormTouched(false);
    setTaxRateForm({
      code: taxRate.code,
      label: taxRate.label,
      rate_percent: Number.parseFloat(taxRate.rate_percent).toFixed(2),
      is_active: taxRate.is_active,
    });
    setActiveTab("gst");
  };

  const handleDeleteTaxRate = async (taxRate: TaxRate) => {
    if (!canManageGst) {
      return;
    }

    setError(null);
    setSavingTaxRate(true);
    try {
      const updated = await apiClient.deactivateTaxRate(taxRate.id);
      setTaxRates((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setToast(`GST ${taxRate.code} deactivated`);
      if (editingTaxRateId === taxRate.id) {
        resetTaxRateForm();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to deactivate GST");
    } finally {
      setSavingTaxRate(false);
    }
  };

  const handleSaveCategory = async () => {
    setCategoryFormTouched(true);
    if (!canManageCategories || !categoryFormIsValid) {
      return;
    }

    setError(null);
    setSavingCategory(true);
    const payload: CategoryPayload = {
      name: categoryForm.name.trim(),
      is_active: categoryForm.is_active,
    };

    try {
      const saved = editingCategoryId
        ? await apiClient.updateCategory(editingCategoryId, payload)
        : await apiClient.createCategory(payload);
      setCategories((current) => {
        if (editingCategoryId) {
          return current.map((item) => (item.id === saved.id ? saved : item));
        }
        return [...current, saved];
      });
      setToast(editingCategoryId ? "Party Category updated" : "Party Category added");
      resetCategoryForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save category");
    } finally {
      setSavingCategory(false);
    }
  };

  const handleSaveBrand = async () => {
    setBrandFormTouched(true);
    if (!canManageCategories || !brandFormIsValid) {
      return;
    }

    setError(null);
    setSavingBrand(true);
    const payload: BrandPayload = {
      name: brandForm.name.trim(),
      is_active: brandForm.is_active,
    };

    try {
      const saved = editingBrandId
        ? await apiClient.updateBrand(editingBrandId, payload)
        : await apiClient.createBrand(payload);
      setBrands((current) => {
        if (editingBrandId) {
          return current.map((item) => (item.id === saved.id ? saved : item));
        }
        return [...current, saved];
      });
      setToast(editingBrandId ? "Brand updated" : "Brand added");
      resetBrandForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save brand");
    } finally {
      setSavingBrand(false);
    }
  };

  const handleEditCategory = (category: Category) => {
    setEditingCategoryId(category.id);
    setCategoryFormTouched(false);
    setCategoryForm({
      name: category.name,
      is_active: category.is_active,
    });
    setActiveTab("categories");
  };

  const handleDeleteCategory = async (category: Category) => {
    if (!canManageCategories) {
      return;
    }
    setError(null);
    setSavingCategory(true);
    try {
      await apiClient.deleteCategory(category.id);
      setCategories((current) => current.filter((item) => item.id !== category.id));
      setToast(`Party Category ${category.name} deleted`);
      if (editingCategoryId === category.id) {
        resetCategoryForm();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to delete category");
    } finally {
      setSavingCategory(false);
    }
  };

  const handleEditBrand = (brand: Brand) => {
    setEditingBrandId(brand.id);
    setBrandFormTouched(false);
    setBrandForm({
      name: brand.name,
      is_active: brand.is_active,
    });
    setActiveTab("brands");
  };

  const handleDeleteBrand = async (brand: Brand) => {
    if (!canManageCategories) {
      return;
    }
    setError(null);
    setSavingBrand(true);
    try {
      await apiClient.deleteBrand(brand.id);
      setBrands((current) => current.filter((item) => item.id !== brand.id));
      setToast(`Brand ${brand.name} deleted`);
      if (editingBrandId === brand.id) {
        resetBrandForm();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to delete brand");
    } finally {
      setSavingBrand(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MasterSettingsMetricTile
          title="GST Slabs"
          value={String(taxRates.length)}
          description={`${activeTaxRatesCount} active`}
          icon={ReceiptText}
          tone="primary"
        />
        <MasterSettingsMetricTile
          title="Brands"
          value={String(brands.length)}
          description={`${activeBrandsCount} active`}
          icon={Tags}
          tone="success"
        />
        <MasterSettingsMetricTile
          title="Party Categories"
          value={String(categories.length)}
          description={`${activeCategoriesCount} active`}
          icon={Tags}
          tone="success"
        />
        <MasterSettingsMetricTile
          title="TDS / TCS"
          value="Planned"
          description="Reserved for the next implementation phase."
          icon={Landmark}
          tone="warning"
        />
      </div>

      <AppTabs tabs={tabs} value={activeTab} onChange={setActiveTab} />

      {toast ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
          {toast}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {activeTab === "gst" ? (
        <AppSectionCard
          title="GST Settings"
          description="Manage tenant GST slabs used by purchasing and item masters."
        >
          {!canViewGst ? (
            <p className="text-sm text-muted-foreground">You do not have permission to view GST settings.</p>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-4">
                <TextField
                  label="Code"
                  value={taxRateForm.code}
                  onChange={(value) => setTaxRateForm((current) => ({ ...current, code: value.toUpperCase() }))}
                  disabled={!canManageGst}
                  error={taxRateFormTouched ? taxRateFormErrors.code : undefined}
                />
                <TextField
                  label="Label"
                  value={taxRateForm.label}
                  onChange={(value) => setTaxRateForm((current) => ({ ...current, label: value }))}
                  disabled={!canManageGst}
                  error={taxRateFormTouched ? taxRateFormErrors.label : undefined}
                  className="md:col-span-2"
                />
                <TextField
                  label="Rate %"
                  value={taxRateForm.rate_percent}
                  onChange={(value) => setTaxRateForm((current) => ({ ...current, rate_percent: value }))}
                  disabled={!canManageGst}
                  error={taxRateFormTouched ? taxRateFormErrors.rate_percent : undefined}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={taxRateForm.is_active}
                    disabled={!canManageGst}
                    onChange={(event) =>
                      setTaxRateForm((current) => ({ ...current, is_active: event.target.checked }))
                    }
                  />
                  Active
                </label>
                <Button type="button" onClick={() => void handleSaveTaxRate()} disabled={savingTaxRate || !canManageGst}>
                  {savingTaxRate ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {editingTaxRateId ? "Update GST" : "Add GST"}
                </Button>
                {editingTaxRateId ? (
                  <Button type="button" variant="outline" onClick={resetTaxRateForm}>
                    Cancel
                  </Button>
                ) : null}
              </div>

              <div className="overflow-hidden rounded-2xl border">
                <Table>
                  <TableHeader className="bg-[hsl(var(--table-header-bg))]">
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead className="text-right">Rate %</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {taxesLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                          Loading GST settings...
                        </TableCell>
                      </TableRow>
                    ) : taxRates.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                          No GST rates configured yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      taxRates
                        .slice()
                        .sort(
                          (left, right) =>
                            Number.parseFloat(left.rate_percent) -
                            Number.parseFloat(right.rate_percent),
                        )
                        .map((taxRate) => (
                          <TableRow key={taxRate.id}>
                            <TableCell className="font-medium">{taxRate.code}</TableCell>
                            <TableCell>{taxRate.label}</TableCell>
                            <TableCell className="text-right">
                              {Number.parseFloat(taxRate.rate_percent).toFixed(2)}%
                            </TableCell>
                            <TableCell>
                              <StatusBadge active={taxRate.is_active} />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleEditTaxRate(taxRate)}
                                  disabled={!canManageGst}
                                >
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void handleDeleteTaxRate(taxRate)}
                                  disabled={!canManageGst || savingTaxRate || !taxRate.is_active}
                                >
                                  Delete
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </AppSectionCard>
      ) : null}

      {activeTab === "brands" ? (
        <AppSectionCard
          title="Brands"
          description="Manage approved brands. Products can only be created against active brands listed here."
        >
          {!canViewCategories ? (
            <p className="text-sm text-muted-foreground">You do not have permission to view brands.</p>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                <TextField
                  label="Brand Name"
                  value={brandForm.name}
                  onChange={(value) => setBrandForm((current) => ({ ...current, name: value }))}
                  disabled={!canManageCategories}
                  error={brandFormTouched ? brandFormErrors.name : undefined}
                />
                <div className="flex items-end gap-3">
                  <label className="inline-flex items-center gap-2 pb-3 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={brandForm.is_active}
                      disabled={!canManageCategories}
                      onChange={(event) =>
                        setBrandForm((current) => ({ ...current, is_active: event.target.checked }))
                      }
                    />
                    Active
                  </label>
                  <Button type="button" onClick={() => void handleSaveBrand()} disabled={savingBrand || !canManageCategories}>
                    {savingBrand ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {editingBrandId ? "Update Brand" : "Add Brand"}
                  </Button>
                  {editingBrandId ? (
                    <Button type="button" variant="outline" onClick={resetBrandForm}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border">
                <Table>
                  <TableHeader className="bg-[hsl(var(--table-header-bg))]">
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {brandsLoading ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                          Loading brands...
                        </TableCell>
                      </TableRow>
                    ) : brands.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                          No brands configured yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      brands
                        .slice()
                        .sort((left, right) => left.name.localeCompare(right.name))
                        .map((brand) => (
                          <TableRow key={brand.id}>
                            <TableCell className="font-medium">{brand.name}</TableCell>
                            <TableCell>
                              <StatusBadge active={brand.is_active} />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleEditBrand(brand)}
                                  disabled={!canManageCategories}
                                >
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void handleDeleteBrand(brand)}
                                  disabled={!canManageCategories || savingBrand}
                                >
                                  Delete
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </AppSectionCard>
      ) : null}

      {activeTab === "categories" ? (
        <AppSectionCard
          title="Party Categories"
          description="Maintain the master list of allowed Party Categories used in Party Master."
        >
          {!canViewCategories ? (
            <p className="text-sm text-muted-foreground">You do not have permission to view party categories.</p>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                <TextField
                  label="Party Category Name"
                  value={categoryForm.name}
                  onChange={(value) => setCategoryForm((current) => ({ ...current, name: value }))}
                  disabled={!canManageCategories}
                  error={categoryFormTouched ? categoryFormErrors.name : undefined}
                />
                <div className="flex items-end gap-3">
                  <label className="inline-flex items-center gap-2 pb-3 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={categoryForm.is_active}
                      disabled={!canManageCategories}
                      onChange={(event) =>
                        setCategoryForm((current) => ({ ...current, is_active: event.target.checked }))
                      }
                    />
                    Active
                  </label>
                  <Button type="button" onClick={() => void handleSaveCategory()} disabled={savingCategory || !canManageCategories}>
                    {savingCategory ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {editingCategoryId ? "Update Party Category" : "Add Party Category"}
                  </Button>
                  {editingCategoryId ? (
                    <Button type="button" variant="outline" onClick={resetCategoryForm}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border">
                <Table>
                  <TableHeader className="bg-[hsl(var(--table-header-bg))]">
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoriesLoading ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                          Loading party categories...
                        </TableCell>
                      </TableRow>
                    ) : categories.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                          No party categories configured yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      categories
                        .slice()
                        .sort((left, right) => left.name.localeCompare(right.name))
                        .map((category) => (
                          <TableRow key={category.id}>
                            <TableCell className="font-medium">{category.name}</TableCell>
                            <TableCell>
                              <StatusBadge active={category.is_active} />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleEditCategory(category)}
                                  disabled={!canManageCategories}
                                >
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void handleDeleteCategory(category)}
                                  disabled={!canManageCategories || savingCategory}
                                >
                                  Delete
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </AppSectionCard>
      ) : null}

      {activeTab === "tds-tcs" ? (
        <AppSectionCard
          title="TDS / TCS"
          description="Reserved for a later implementation phase."
        >
          <div className="rounded-2xl border border-dashed border-[hsl(var(--card-border))] bg-[hsl(var(--muted-bg))] px-5 py-8 text-sm text-[hsl(var(--text-secondary))]">
            TDS / TCS settings will be added here next. The tab is intentionally in place so Master Settings remains the single home for tax and category configuration.
          </div>
        </AppSectionCard>
      ) : null}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  error,
  disabled,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled: boolean;
  className?: string;
}) {
  return (
    <label className={`block space-y-2 ${className ?? ""}`.trim()}>
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full rounded-2xl border bg-background px-4 py-3 text-sm outline-none transition focus:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-70"
      />
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </label>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={
        active
          ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300"
      }
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function MasterSettingsMetricTile({
  title,
  value,
  description,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  description: string;
  icon: LucideIcon;
  tone: "primary" | "success" | "warning";
}) {
  const toneClasses =
    tone === "primary"
      ? "bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
      : tone === "success"
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
        : "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300";

  return (
    <div className="flex h-full min-h-[122px] flex-col justify-between rounded-3xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card-bg))] p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[hsl(var(--text-secondary))]">
            {title}
          </p>
          <p className="text-2xl font-semibold leading-none tracking-tight text-[hsl(var(--text-primary))]">
            {value}
          </p>
        </div>
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${toneClasses}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="min-h-[48px] pt-4 text-sm leading-6 text-[hsl(var(--text-secondary))]">
        {description}
      </p>
    </div>
  );
}
