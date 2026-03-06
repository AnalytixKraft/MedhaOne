"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ImageIcon,
  Loader2,
  Palette,
  Plus,
  Shield,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { usePermissions } from "@/components/auth/permission-provider";
import { PageTitle } from "@/components/layout/page-title";
import {
  apiClient,
  type CompanySettings,
  type CompanySettingsPayload,
  type TaxRate,
} from "@/lib/api/client";
import { rbacClient, type OrgUserRecord } from "@/lib/rbac/client";

type SettingsTab =
  | "overview"
  | "company-profile"
  | "organization-users"
  | "taxes"
  | "branding";

type FormState = {
  company_name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  gst_number: string;
  phone: string;
  email: string;
  logo_url: string;
};

type UserFormState = {
  fullName: string;
  email: string;
  password: string;
  role: "READ_WRITE" | "SERVICE_SUPPORT" | "VIEW_ONLY";
};

type TaxRateFormState = {
  code: string;
  label: string;
  rate_percent: string;
  is_active: boolean;
};

const emptyForm: FormState = {
  company_name: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  gst_number: "",
  phone: "",
  email: "",
  logo_url: "",
};

const emptyUserForm: UserFormState = {
  fullName: "",
  email: "",
  password: "",
  role: "READ_WRITE",
};

const emptyTaxRateForm: TaxRateFormState = {
  code: "",
  label: "",
  rate_percent: "",
  is_active: true,
};

const tabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "company-profile", label: "Company Profile" },
  { id: "organization-users", label: "Organization Users" },
  { id: "taxes", label: "Taxes" },
  { id: "branding", label: "Branding" },
];

export default function SettingsPage() {
  const { user, hasPermission, loading: permissionsLoading } = usePermissions();
  const [activeTab, setActiveTab] = useState<SettingsTab>("overview");
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editMode, setEditMode] = useState(false);
  const [companyLoading, setCompanyLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [orgUsers, setOrgUsers] = useState<OrgUserRecord[]>([]);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [userForm, setUserForm] = useState<UserFormState>(emptyUserForm);
  const [userFormTouched, setUserFormTouched] = useState(false);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [taxesLoading, setTaxesLoading] = useState(true);
  const [savingTaxRate, setSavingTaxRate] = useState(false);
  const [taxRateForm, setTaxRateForm] = useState<TaxRateFormState>(emptyTaxRateForm);
  const [taxRateFormTouched, setTaxRateFormTouched] = useState(false);
  const [editingTaxRateId, setEditingTaxRateId] = useState<number | null>(null);

  const hasTenantContext = Boolean(user?.organization_slug);
  const isOrgAdmin =
    !!user &&
    (user.role?.name === "ORG_ADMIN" ||
      user.roles.some((role) => role.name === "ORG_ADMIN"));
  const canEditCompany = !!user && (user.is_superuser || hasPermission("settings:update"));
  const canManageUsers = !!user && (user.is_superuser || hasPermission("settings:update"));
  const canViewTaxes = !!user && (user.is_superuser || isOrgAdmin || hasPermission("tax:view"));
  const canManageTaxes =
    !!user && (user.is_superuser || isOrgAdmin || hasPermission("tax:manage"));
  const tabLoading = companyLoading || usersLoading || taxesLoading;

  useEffect(() => {
    if (!canEditCompany) {
      setEditMode(false);
    }
  }, [canEditCompany]);

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
      if (!hasTenantContext) {
        setCompanyLoading(false);
        setUsersLoading(false);
        setTaxesLoading(false);
        return;
      }

      setCompanyLoading(true);
      setUsersLoading(true);
      setTaxesLoading(true);
      try {
        const [company, users, taxes] = await Promise.all([
          apiClient.getCompanySettings(),
          rbacClient.listUsers(),
          canViewTaxes ? apiClient.listTaxRates(true) : Promise.resolve([] as TaxRate[]),
        ]);
        if (!cancelled) {
          hydrateCompany(company);
          setCompanySettings(company);
          setOrgUsers(users);
          setTaxRates(taxes);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Failed to load organization settings");
        }
      } finally {
        if (!cancelled) {
          setCompanyLoading(false);
          setUsersLoading(false);
          setTaxesLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [canViewTaxes, hasTenantContext]);

  const fieldErrors = useMemo(() => {
    const errors: Partial<Record<keyof FormState, string>> = {};
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = "Enter a valid email address.";
    }
    if (form.pincode && !/^[A-Za-z0-9-]{4,12}$/.test(form.pincode)) {
      errors.pincode = "Enter a valid pincode.";
    }
    if (form.phone && form.phone.trim().length < 7) {
      errors.phone = "Enter a valid phone number.";
    }
    return errors;
  }, [form.email, form.phone, form.pincode]);

  const userFormErrors = useMemo(() => {
    const errors: Partial<Record<keyof UserFormState, string>> = {};
    if (userForm.fullName.trim().length < 2) {
      errors.fullName = "Name is required.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userForm.email)) {
      errors.email = "Enter a valid email.";
    }
    if (userForm.password.length < 12) {
      errors.password = "Password must be at least 12 characters.";
    }
    return errors;
  }, [userForm.email, userForm.fullName, userForm.password]);

  const taxRateFormErrors = useMemo(() => {
    const errors: Partial<Record<keyof TaxRateFormState, string>> = {};
    const normalizedCode = taxRateForm.code.trim().toUpperCase();
    if (!normalizedCode) {
      errors.code = "Code is required.";
    } else if (!/^[A-Z0-9_]+$/.test(normalizedCode)) {
      errors.code = "Use uppercase letters, numbers, and underscore only.";
    }

    if (!taxRateForm.label.trim()) {
      errors.label = "Label is required.";
    }

    const rate = Number.parseFloat(taxRateForm.rate_percent);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      errors.rate_percent = "Rate must be between 0 and 100.";
    } else {
      const hasDuplicateActiveRate = taxRates.some(
        (rateRecord) =>
          rateRecord.is_active &&
          rateRecord.id !== editingTaxRateId &&
          Math.abs(Number.parseFloat(rateRecord.rate_percent) - rate) < 0.000_001,
      );
      if (hasDuplicateActiveRate && taxRateForm.is_active) {
        errors.rate_percent = "An active tax rate with this percent already exists.";
      }
    }

    return errors;
  }, [
    editingTaxRateId,
    taxRateForm.code,
    taxRateForm.is_active,
    taxRateForm.label,
    taxRateForm.rate_percent,
    taxRates,
  ]);

  const companyIsValid = Object.keys(fieldErrors).length === 0;
  const userFormIsValid = Object.keys(userFormErrors).length === 0;
  const taxRateFormIsValid = Object.keys(taxRateFormErrors).length === 0;

  const adminCount = useMemo(
    () => orgUsers.filter((member) => member.role === "ORG_ADMIN").length,
    [orgUsers],
  );
  const pendingInvites = useMemo(
    () => orgUsers.filter((member) => !member.lastLoginAt).length,
    [orgUsers],
  );
  const activeTaxRatesCount = useMemo(
    () => taxRates.filter((taxRate) => taxRate.is_active).length,
    [taxRates],
  );
  const companyName =
    companySettings?.company_name?.trim() ||
    companySettings?.organization_name?.trim() ||
    user?.organization_slug?.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ||
    "Organization";

  const formattedAddress = formatAddress({
    address: form.address,
    city: form.city,
    state: form.state,
    pincode: form.pincode,
  });

  function hydrateCompany(settings: CompanySettings) {
    setCompanySettings(settings);
    setForm({
      company_name: settings.company_name ?? "",
      address: settings.address ?? "",
      city: settings.city ?? "",
      state: settings.state ?? "",
      pincode: settings.pincode ?? "",
      gst_number: settings.gst_number ?? "",
      phone: settings.phone ?? "",
      email: settings.email ?? "",
      logo_url: settings.logo_url ?? "",
    });
    setTouched(false);
  }

  const saveCompanySettings = async () => {
    setTouched(true);
    if (!companyIsValid || !canEditCompany) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await apiClient.updateCompanySettings(buildPayload(form));
      hydrateCompany(updated);
      setEditMode(false);
      setToast("Company profile updated");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to update company settings");
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (file: File | null) => {
    if (!file || !canEditCompany) {
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    const nextForm = { ...form, logo_url: dataUrl };
    setForm(nextForm);
    setSaving(true);
    setError(null);
    try {
      const updated = await apiClient.updateCompanySettings(buildPayload(nextForm));
      hydrateCompany(updated);
      setToast("Branding updated");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to update branding");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateUser = async () => {
    setUserFormTouched(true);
    if (!userFormIsValid || !canManageUsers) {
      return;
    }

    setCreatingUser(true);
    setError(null);
    try {
      const created = await rbacClient.createUser(undefined, {
        email: userForm.email.trim(),
        password: userForm.password,
        fullName: userForm.fullName.trim(),
        role: userForm.role,
      });
      setOrgUsers((current) => [created, ...current]);
      setUserForm(emptyUserForm);
      setUserFormTouched(false);
      setAddUserOpen(false);
      setToast("User added");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to create user");
    } finally {
      setCreatingUser(false);
    }
  };

  const resetTaxRateForm = () => {
    setTaxRateForm(emptyTaxRateForm);
    setTaxRateFormTouched(false);
    setEditingTaxRateId(null);
  };

  const handleSaveTaxRate = async () => {
    setTaxRateFormTouched(true);
    if (!canManageTaxes || !taxRateFormIsValid) {
      return;
    }

    const normalizedCode = taxRateForm.code.trim().toUpperCase();
    const payload = {
      code: normalizedCode,
      label: taxRateForm.label.trim(),
      rate_percent: Number.parseFloat(taxRateForm.rate_percent),
      is_active: taxRateForm.is_active,
    };

    setSavingTaxRate(true);
    setError(null);
    try {
      const saved = editingTaxRateId
        ? await apiClient.updateTaxRate(editingTaxRateId, payload)
        : await apiClient.createTaxRate(payload);

      setTaxRates((current) => {
        if (editingTaxRateId) {
          return current.map((item) => (item.id === saved.id ? saved : item));
        }
        return [saved, ...current];
      });

      setToast(editingTaxRateId ? "Tax rate updated" : "Tax rate added");
      resetTaxRateForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save tax rate");
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
      rate_percent: Number.parseFloat(taxRate.rate_percent).toString(),
      is_active: taxRate.is_active,
    });
    setActiveTab("taxes");
  };

  const handleToggleTaxRate = async (taxRate: TaxRate) => {
    if (!canManageTaxes) {
      return;
    }

    setSavingTaxRate(true);
    setError(null);
    try {
      const updated = await apiClient.updateTaxRate(taxRate.id, {
        is_active: !taxRate.is_active,
      });
      setTaxRates((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setToast(updated.is_active ? "Tax rate activated" : "Tax rate deactivated");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to update tax rate");
    } finally {
      setSavingTaxRate(false);
    }
  };

  if (permissionsLoading) {
    return (
      <div className="space-y-6">
        <PageTitle title="Settings" description="Loading organization settings context." />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-3xl bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (!hasTenantContext) {
    return (
      <div className="space-y-6">
        <PageTitle
          title="Settings"
          description="Company settings are available when you are signed in to an organization through the main ERP login."
        />
        <section className="rounded-3xl border bg-card p-6 shadow-sm">
          <p className="text-sm text-muted-foreground">
            Sign in through <span className="font-medium">/login</span> as an organization user to access tenant-specific settings.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Settings"
        description="Company profile, users, and branding controls for the current organization."
      />
      <div className="flex justify-end">
        <Link
          href="/settings/bulk-import"
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Bulk Import
        </Link>
      </div>

      {toast ? (
        <div className="fixed right-4 top-20 z-50 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 shadow-lg">
          {toast}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-3xl border bg-card p-2 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                activeTab === tab.id
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "overview" ? (
        tabLoading ? (
          <div className="grid gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-48 animate-pulse rounded-3xl bg-muted" />
            ))}
          </div>
        ) : (
        <div className="grid gap-4 lg:grid-cols-4">
          <OverviewCard
            icon={Building2}
            title="Company Summary"
            actionLabel={canEditCompany ? "Edit Profile" : "View Profile"}
            onAction={() => {
              setActiveTab("company-profile");
              if (canEditCompany) {
                setEditMode(true);
              }
            }}
          >
            <OverviewRow label="Company Name" value={companyName} />
            <OverviewRow
              label="GST Number"
              value={form.gst_number || "Not Configured"}
              badge={!form.gst_number ? "warning" : undefined}
            />
            <OverviewRow label="Registered Address" value={formattedAddress || "Not configured"} />
          </OverviewCard>

          <OverviewCard
            icon={Users}
            title="Users Summary"
            actionLabel="Manage Users"
            onAction={() => setActiveTab("organization-users")}
          >
            <OverviewRow label="Total Users" value={String(orgUsers.length)} />
            <OverviewRow label="Admin Count" value={String(adminCount)} />
            <OverviewRow label="Pending Invites" value={String(pendingInvites)} />
          </OverviewCard>

          <OverviewCard
            icon={Shield}
            title="Tax Master"
            actionLabel={canViewTaxes ? "Manage Taxes" : "View Taxes"}
            onAction={() => setActiveTab("taxes")}
          >
            <OverviewRow label="Total Slabs" value={String(taxRates.length)} />
            <OverviewRow label="Active Slabs" value={String(activeTaxRatesCount)} />
            <OverviewRow
              label="Manage Access"
              value={canManageTaxes ? "tax:manage" : "Read only"}
            />
          </OverviewCard>

          <OverviewCard
            icon={Palette}
            title="Branding"
            actionLabel={canEditCompany ? "Change Logo" : "View Branding"}
            onAction={() => setActiveTab("branding")}
          >
            <div className="flex items-center gap-4">
              {form.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.logo_url}
                  alt={companyName}
                  className="h-16 w-16 rounded-2xl border object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border bg-muted">
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div>
                <p className="text-sm font-medium">{companyName}</p>
                <p className="text-sm text-muted-foreground">
                  {form.logo_url ? "Logo configured" : "No logo configured"}
                </p>
              </div>
            </div>
          </OverviewCard>
        </div>
        )
      ) : null}

      {activeTab === "company-profile" ? (
        <section className="rounded-3xl border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Company Profile</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Review your current registered details and update them when required.
              </p>
            </div>
            {!editMode && canEditCompany ? (
              <button
                type="button"
                onClick={() => setEditMode(true)}
                className="rounded-2xl bg-foreground px-4 py-2.5 text-sm font-medium text-background"
              >
                Edit Profile
              </button>
            ) : editMode ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (companySettings) {
                      hydrateCompany(companySettings);
                    }
                    setEditMode(false);
                  }}
                  className="rounded-2xl border px-4 py-2.5 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveCompanySettings}
                  disabled={saving || !canEditCompany}
                  className="inline-flex items-center gap-2 rounded-2xl bg-foreground px-4 py-2.5 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  <span>Save Changes</span>
                </button>
              </div>
            ) : (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                Read only
              </span>
            )}
          </div>

          {companyLoading ? (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-20 animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : !editMode ? (
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <KeyValue label="Company Name" value={companyName} />
              <KeyValue label="Email" value={form.email || "Not added"} />
              <KeyValue label="Phone" value={form.phone || "Not added"} />
              <KeyValue
                label="GST"
                value={form.gst_number || "Not Added"}
                badge={!form.gst_number ? "warning" : undefined}
              />
              <KeyValue label="Address" value={formattedAddress || "Not configured"} className="md:col-span-2" />
            </div>
          ) : (
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <Field
                label="Company Name"
                value={form.company_name}
                onChange={(value) => setForm((current) => ({ ...current, company_name: value }))}
                disabled={!canEditCompany}
              />
              <Field
                label="Email"
                value={form.email}
                onChange={(value) => setForm((current) => ({ ...current, email: value }))}
                disabled={!canEditCompany}
                error={touched ? fieldErrors.email : undefined}
              />
              <Field
                label="Phone"
                value={form.phone}
                onChange={(value) => setForm((current) => ({ ...current, phone: value }))}
                disabled={!canEditCompany}
                error={touched ? fieldErrors.phone : undefined}
              />
              <Field
                label="GST Number"
                value={form.gst_number}
                onChange={(value) => setForm((current) => ({ ...current, gst_number: value }))}
                disabled={!canEditCompany}
              />
              <Field
                label="Address"
                value={form.address}
                onChange={(value) => setForm((current) => ({ ...current, address: value }))}
                disabled={!canEditCompany}
                multiline
                className="md:col-span-2"
              />
              <Field
                label="City"
                value={form.city}
                onChange={(value) => setForm((current) => ({ ...current, city: value }))}
                disabled={!canEditCompany}
              />
              <Field
                label="State"
                value={form.state}
                onChange={(value) => setForm((current) => ({ ...current, state: value }))}
                disabled={!canEditCompany}
              />
              <Field
                label="Pincode"
                value={form.pincode}
                onChange={(value) => setForm((current) => ({ ...current, pincode: value }))}
                disabled={!canEditCompany}
                error={touched ? fieldErrors.pincode : undefined}
              />
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "organization-users" ? (
        <section className="rounded-3xl border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Organization Users</h2>
              <p className="mt-1 text-sm text-muted-foreground">{orgUsers.length} Members</p>
            </div>
            <button
              type="button"
              onClick={() => setAddUserOpen((current) => !current)}
              disabled={!canManageUsers}
              className="inline-flex items-center gap-2 rounded-2xl bg-foreground px-4 py-2.5 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              <span>Add User</span>
            </button>
          </div>

          {addUserOpen ? (
            <div className="mt-5 rounded-3xl border bg-background p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Full Name"
                  value={userForm.fullName}
                  onChange={(value) => setUserForm((current) => ({ ...current, fullName: value }))}
                  disabled={!canManageUsers}
                  error={userFormTouched ? userFormErrors.fullName : undefined}
                />
                <Field
                  label="Email"
                  value={userForm.email}
                  onChange={(value) => setUserForm((current) => ({ ...current, email: value }))}
                  disabled={!canManageUsers}
                  error={userFormTouched ? userFormErrors.email : undefined}
                />
                <Field
                  label="Password"
                  type="password"
                  value={userForm.password}
                  onChange={(value) => setUserForm((current) => ({ ...current, password: value }))}
                  disabled={!canManageUsers}
                  error={userFormTouched ? userFormErrors.password : undefined}
                />
                <label className="block space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Role
                  </span>
                  <select
                    value={userForm.role}
                    disabled={!canManageUsers}
                    onChange={(event) =>
                      setUserForm((current) => ({
                        ...current,
                        role: event.target.value as UserFormState["role"],
                      }))
                    }
                    className="w-full rounded-2xl border bg-background px-4 py-3 text-sm outline-none transition focus:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <option value="READ_WRITE">READ_WRITE</option>
                    <option value="SERVICE_SUPPORT">SERVICE_SUPPORT</option>
                    <option value="VIEW_ONLY">VIEW_ONLY</option>
                  </select>
                </label>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAddUserOpen(false);
                    setUserForm(emptyUserForm);
                    setUserFormTouched(false);
                  }}
                  className="rounded-2xl border px-4 py-2.5 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateUser}
                  disabled={creatingUser || !canManageUsers}
                  className="inline-flex items-center gap-2 rounded-2xl bg-foreground px-4 py-2.5 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creatingUser ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  <span>Add User</span>
                </button>
              </div>
            </div>
          ) : null}

          {usersLoading ? (
            <div className="mt-6 grid gap-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-14 animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    <th className="px-2 py-3">User</th>
                    <th className="px-2 py-3">Email</th>
                    <th className="px-2 py-3">Role</th>
                    <th className="px-2 py-3">Status</th>
                    <th className="px-2 py-3">Last Active</th>
                    <th className="px-2 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orgUsers.map((member) => {
                    const status = member.lastLoginAt ? "Active" : "Invited";
                    return (
                      <tr key={member.id} className="border-b last:border-b-0">
                        <td className="px-2 py-4">
                          <div className="flex items-center gap-3">
                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                              {initials(member.fullName)}
                            </span>
                            <span className="font-medium">{member.fullName}</span>
                          </div>
                        </td>
                        <td className="px-2 py-4 text-sm text-muted-foreground">{member.email}</td>
                        <td className="px-2 py-4">
                          <RoleBadge role={member.role} />
                        </td>
                        <td className="px-2 py-4">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                              status === "Active"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {status}
                          </span>
                        </td>
                        <td className="px-2 py-4 text-sm text-muted-foreground">
                          {member.lastLoginAt ? formatDateTime(member.lastLoginAt) : "Pending first sign-in"}
                        </td>
                        <td className="px-2 py-4 text-right text-sm text-muted-foreground">•••</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "taxes" ? (
        <section className="rounded-3xl border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Tax Rates</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Tenant-scoped GST rates used by purchase transactions.
              </p>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
              {activeTaxRatesCount} active / {taxRates.length} total
            </span>
          </div>

          {!canViewTaxes ? (
            <p className="mt-5 text-sm text-muted-foreground">
              You do not have permission to view tax rates.
            </p>
          ) : (
            <>
              <div className="mt-5 rounded-3xl border bg-background p-5">
                <div className="grid gap-4 md:grid-cols-4">
                  <Field
                    label="Code"
                    value={taxRateForm.code}
                    onChange={(value) =>
                      setTaxRateForm((current) => ({ ...current, code: value.toUpperCase() }))
                    }
                    disabled={!canManageTaxes}
                    error={taxRateFormTouched ? taxRateFormErrors.code : undefined}
                  />
                  <Field
                    label="Label"
                    value={taxRateForm.label}
                    onChange={(value) =>
                      setTaxRateForm((current) => ({ ...current, label: value }))
                    }
                    disabled={!canManageTaxes}
                    error={taxRateFormTouched ? taxRateFormErrors.label : undefined}
                    className="md:col-span-2"
                  />
                  <Field
                    label="Rate %"
                    value={taxRateForm.rate_percent}
                    onChange={(value) =>
                      setTaxRateForm((current) => ({ ...current, rate_percent: value }))
                    }
                    disabled={!canManageTaxes}
                    error={taxRateFormTouched ? taxRateFormErrors.rate_percent : undefined}
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={taxRateForm.is_active}
                      disabled={!canManageTaxes}
                      onChange={(event) =>
                        setTaxRateForm((current) => ({
                          ...current,
                          is_active: event.target.checked,
                        }))
                      }
                    />
                    Active
                  </label>

                  <button
                    type="button"
                    onClick={handleSaveTaxRate}
                    disabled={savingTaxRate || !canManageTaxes}
                    className="inline-flex items-center gap-2 rounded-2xl bg-foreground px-4 py-2.5 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingTaxRate ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    <span>{editingTaxRateId ? "Update Tax Rate" : "Add Tax Rate"}</span>
                  </button>
                  {editingTaxRateId ? (
                    <button
                      type="button"
                      onClick={resetTaxRateForm}
                      className="rounded-2xl border px-4 py-2.5 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>

              {taxesLoading ? (
                <div className="mt-6 grid gap-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="h-14 animate-pulse rounded-2xl bg-muted" />
                  ))}
                </div>
              ) : (
                <div className="mt-6 overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        <th className="px-2 py-3">Code</th>
                        <th className="px-2 py-3">Label</th>
                        <th className="px-2 py-3 text-right">Rate %</th>
                        <th className="px-2 py-3">Status</th>
                        <th className="px-2 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taxRates
                        .slice()
                        .sort(
                          (left, right) =>
                            Number.parseFloat(left.rate_percent) -
                            Number.parseFloat(right.rate_percent),
                        )
                        .map((taxRate) => (
                          <tr key={taxRate.id} className="border-b last:border-b-0">
                            <td className="px-2 py-4 text-sm font-medium">{taxRate.code}</td>
                            <td className="px-2 py-4 text-sm">{taxRate.label}</td>
                            <td className="px-2 py-4 text-right text-sm tabular-nums">
                              {Number.parseFloat(taxRate.rate_percent).toFixed(2)}
                            </td>
                            <td className="px-2 py-4">
                              <span
                                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                  taxRate.is_active
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-slate-100 text-slate-700"
                                }`}
                              >
                                {taxRate.is_active ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td className="px-2 py-4 text-right">
                              <div className="inline-flex items-center gap-3 text-sm">
                                <button
                                  type="button"
                                  onClick={() => handleEditTaxRate(taxRate)}
                                  disabled={!canManageTaxes}
                                  className="font-medium text-sky-600 disabled:cursor-not-allowed disabled:text-slate-400"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleToggleTaxRate(taxRate)}
                                  disabled={!canManageTaxes || savingTaxRate}
                                  className="font-medium text-slate-600 disabled:cursor-not-allowed disabled:text-slate-400"
                                >
                                  {taxRate.is_active ? "Deactivate" : "Activate"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      ) : null}

      {activeTab === "branding" ? (
        <section className="rounded-3xl border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Branding</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage the organization logo and visual identity used in the ERP shell.
              </p>
            </div>
            <label
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium ${
                canEditCompany && !saving
                  ? "cursor-pointer bg-foreground text-background"
                  : "cursor-not-allowed bg-muted text-muted-foreground"
              }`}
            >
              <Plus className="h-4 w-4" />
              <span>
                {canEditCompany ? (form.logo_url ? "Change Logo" : "Upload Logo") : "View Only"}
              </span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={!canEditCompany || saving}
                onChange={(event) => void handleLogoUpload(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          {companyLoading ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {Array.from({ length: 2 }).map((_, index) => (
                <div key={index} className="h-48 animate-pulse rounded-3xl bg-muted" />
              ))}
            </div>
          ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr]">
            <div className="rounded-3xl border bg-background p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Logo Preview</p>
              <div className="mt-4 flex h-40 items-center justify-center rounded-3xl border bg-card">
                {form.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.logo_url}
                    alt={companyName}
                    className="h-28 w-28 rounded-3xl border object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-3xl border bg-muted">
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border bg-background p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Theme</p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <ThemeTile label="Core Shell" value="Slate / Neutral" icon={Palette} />
                <ThemeTile label="Header Brand" value={companyName} icon={Building2} />
                <ThemeTile label="Footer" value="Powered by MedhaOne" icon={Shield} />
              </div>
            </div>
          </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function OverviewCard({
  icon: Icon,
  title,
  actionLabel,
  onAction,
  children,
}: {
  icon: LucideIcon;
  title: string;
  actionLabel: string;
  onAction: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded-2xl border p-3 text-muted-foreground">
            <Icon className="h-5 w-5" />
          </span>
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onAction}
          className="text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          {actionLabel}
        </button>
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

function OverviewRow({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: "warning";
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        <p className="text-sm">{value}</p>
        {badge === "warning" ? (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
            Not Configured
          </span>
        ) : null}
      </div>
    </div>
  );
}

function KeyValue({
  label,
  value,
  badge,
  className,
}: {
  label: string;
  value: string;
  badge?: "warning";
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        <p className="text-sm font-medium">{value}</p>
        {badge === "warning" ? (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Not Added</span>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  disabled,
  multiline = false,
  type = "text",
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled: boolean;
  multiline?: boolean;
  type?: "text" | "email" | "password";
  className?: string;
}) {
  const classes =
    "w-full rounded-2xl border bg-background px-4 py-3 text-sm outline-none transition focus:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-70";

  return (
    <label className={className ? `block space-y-2 ${className}` : "block space-y-2"}>
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      {multiline ? (
        <textarea
          rows={4}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={classes}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={classes}
        />
      )}
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </label>
  );
}

function RoleBadge({ role }: { role: OrgUserRecord["role"] }) {
  const tone =
    role === "ORG_ADMIN"
      ? "bg-sky-50 text-sky-700"
      : role === "SERVICE_SUPPORT"
        ? "bg-slate-100 text-slate-700"
        : "bg-emerald-50 text-emerald-700";

  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{role}</span>;
}

function ThemeTile({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{value}</p>
    </div>
  );
}

function buildPayload(form: FormState): CompanySettingsPayload {
  return {
    company_name: toNullable(form.company_name),
    address: toNullable(form.address),
    city: toNullable(form.city),
    state: toNullable(form.state),
    pincode: toNullable(form.pincode),
    gst_number: toNullable(form.gst_number),
    phone: toNullable(form.phone),
    email: toNullable(form.email),
    logo_url: toNullable(form.logo_url),
  };
}

function toNullable(value: string) {
  const next = value.trim();
  return next ? next : null;
}

function formatAddress(input: {
  address: string;
  city: string;
  state: string;
  pincode: string;
}) {
  return [input.address, [input.city, input.state, input.pincode].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" • ");
}

function initials(name: string) {
  const parts = name.split(" ").filter(Boolean);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}
