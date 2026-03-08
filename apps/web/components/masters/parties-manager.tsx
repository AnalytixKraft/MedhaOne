"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Save, SquarePen, Trash2 } from "lucide-react";

import { usePermissions } from "@/components/auth/permission-provider";
import {
  AppActionBar,
  AppFormGrid,
  AppSectionCard,
  AppSummaryPanel,
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
  type BulkImportError,
  type Party,
  type PartyCategory,
  type PartyPayload,
  type PartyType,
  type RegistrationType,
  type OutstandingTrackingMode,
} from "@/lib/api/client";
import {
  extractPanFromGstin,
  extractStateFromGstin,
  GSTIN_PATTERN,
  normalizeGstin,
} from "@/lib/gst";
import { cn } from "@/lib/utils";

type ViewMode = "form" | "grid";

const partyTypeOptions: PartyType[] = ["CUSTOMER", "SUPPLIER", "BOTH"];
const partyCategoryOptions: PartyCategory[] = [
  "RETAILER",
  "DISTRIBUTOR",
  "STOCKIST",
  "HOSPITAL",
  "PHARMACY",
  "INSTITUTION",
  "OTHER",
];
const registrationTypeOptions: RegistrationType[] = [
  "REGISTERED",
  "UNREGISTERED",
  "COMPOSITION",
  "SEZ",
  "OTHER",
];
const outstandingTrackingOptions: OutstandingTrackingMode[] = [
  "BILL_WISE",
  "FIFO",
  "ON_ACCOUNT",
];

type PartyFormState = {
  party_name: string;
  display_name: string;
  party_code: string;
  party_type: PartyType;
  party_category: PartyCategory | "";
  contact_person: string;
  designation: string;
  mobile: string;
  whatsapp_no: string;
  office_phone: string;
  email: string;
  website: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  gstin: string;
  pan_number: string;
  registration_type: RegistrationType | "";
  drug_license_number: string;
  fssai_number: string;
  udyam_number: string;
  credit_limit: string;
  payment_terms: string;
  opening_balance: string;
  outstanding_tracking_mode: OutstandingTrackingMode;
  is_active: boolean;
};

type GridRow = {
  id: string;
  party_name: string;
  party_type: PartyType;
  party_category: PartyCategory | "";
  contact_person: string;
  mobile: string;
  gstin: string;
  pan_number: string;
  state: string;
  state_overridden: boolean;
  city: string;
  pincode: string;
  drug_license_number: string;
  fssai_number: string;
  udyam_number: string;
  is_active: boolean;
};

type GridField =
  | "party_name"
  | "party_type"
  | "party_category"
  | "contact_person"
  | "mobile"
  | "gstin"
  | "pan_number"
  | "state"
  | "city"
  | "pincode"
  | "drug_license_number"
  | "fssai_number"
  | "udyam_number";

type ValidationErrors = Partial<Record<string, string>>;

const gridFieldOrder: GridField[] = [
  "party_name",
  "party_type",
  "party_category",
  "contact_person",
  "mobile",
  "gstin",
  "pan_number",
  "state",
  "city",
  "pincode",
  "drug_license_number",
  "fssai_number",
  "udyam_number",
];

function createEmptyForm(): PartyFormState {
  return {
    party_name: "",
    display_name: "",
    party_code: "",
    party_type: "CUSTOMER",
    party_category: "",
    contact_person: "",
    designation: "",
    mobile: "",
    whatsapp_no: "",
    office_phone: "",
    email: "",
    website: "",
    address_line_1: "",
    address_line_2: "",
    city: "",
    state: "",
    pincode: "",
    country: "India",
    gstin: "",
    pan_number: "",
    registration_type: "",
    drug_license_number: "",
    fssai_number: "",
    udyam_number: "",
    credit_limit: "0.00",
    payment_terms: "",
    opening_balance: "0.00",
    outstanding_tracking_mode: "BILL_WISE",
    is_active: true,
  };
}

function createEmptyGridRow(index: number): GridRow {
  return {
    id: `party-grid-${index}`,
    party_name: "",
    party_type: "CUSTOMER",
    party_category: "",
    contact_person: "",
    mobile: "",
    gstin: "",
    pan_number: "",
    state: "",
    state_overridden: false,
    city: "",
    pincode: "",
    drug_license_number: "",
    fssai_number: "",
    udyam_number: "",
    is_active: true,
  };
}

function isGridRowBlank(row: GridRow) {
  return !(
    row.party_name ||
    row.contact_person ||
    row.mobile ||
    row.gstin ||
    row.pan_number ||
    row.state ||
    row.city ||
    row.pincode ||
    row.drug_license_number ||
    row.fssai_number ||
    row.udyam_number
  );
}

function applyGstinIntelligence<T extends { gstin: string; pan_number: string; state: string }>(
  record: T,
  rawValue: string,
  stateOverridden = false,
): T {
  const gstin = normalizeGstin(rawValue);
  if (!gstin) {
    return { ...record, gstin: "", pan_number: "" } as T;
  }
  if (!GSTIN_PATTERN.test(gstin)) {
    return { ...record, gstin, pan_number: "" } as T;
  }
  return {
    ...record,
    gstin,
    pan_number: extractPanFromGstin(gstin),
    state: stateOverridden ? record.state : extractStateFromGstin(gstin),
  } as T;
}

function toPartyPayload(form: PartyFormState): PartyPayload {
  return {
    party_name: form.party_name.trim(),
    display_name: form.display_name.trim() || undefined,
    party_code: form.party_code.trim() || undefined,
    party_type: form.party_type,
    party_category: form.party_category || undefined,
    contact_person: form.contact_person.trim() || undefined,
    designation: form.designation.trim() || undefined,
    mobile: form.mobile.trim() || undefined,
    whatsapp_no: form.whatsapp_no.trim() || undefined,
    office_phone: form.office_phone.trim() || undefined,
    email: form.email.trim() || undefined,
    website: form.website.trim() || undefined,
    address_line_1: form.address_line_1.trim() || undefined,
    address_line_2: form.address_line_2.trim() || undefined,
    city: form.city.trim() || undefined,
    state: form.state.trim() || undefined,
    pincode: form.pincode.trim() || undefined,
    country: form.country.trim() || undefined,
    gstin: form.gstin.trim() || undefined,
    pan_number: form.gstin.trim() ? undefined : form.pan_number.trim() || undefined,
    registration_type: form.registration_type || undefined,
    drug_license_number: form.drug_license_number.trim() || undefined,
    fssai_number: form.fssai_number.trim() || undefined,
    udyam_number: form.udyam_number.trim() || undefined,
    credit_limit: form.credit_limit.trim() || undefined,
    payment_terms: form.payment_terms.trim() || undefined,
    opening_balance: form.opening_balance.trim() || undefined,
    outstanding_tracking_mode: form.outstanding_tracking_mode,
    is_active: form.is_active,
  };
}

function validateForm(form: PartyFormState): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!form.party_name.trim()) {
    errors.party_name = "Party Name is required";
  }
  if (!form.party_type) {
    errors.party_type = "Party Type is required";
  }
  if (form.gstin.trim() && !GSTIN_PATTERN.test(form.gstin.trim())) {
    errors.gstin = "Invalid GSTIN format";
  }
  if (form.pincode.trim() && !/^\d{6}$/.test(form.pincode.trim())) {
    errors.pincode = "PIN Code must be 6 digits";
  }
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = "Invalid email address";
  }
  if (form.credit_limit.trim() && Number(form.credit_limit) < 0) {
    errors.credit_limit = "Credit limit cannot be negative";
  }
  return errors;
}

function validateGridRow(row: GridRow): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!row.party_name.trim()) {
    errors.party_name = "Required";
  }
  if (row.gstin.trim() && !GSTIN_PATTERN.test(row.gstin.trim())) {
    errors.gstin = "Invalid GSTIN";
  }
  if (row.mobile.trim() && !/^\d{10}$/.test(row.mobile.trim())) {
    errors.mobile = "10 digits required";
  }
  if (row.pincode.trim() && !/^\d{6}$/.test(row.pincode.trim())) {
    errors.pincode = "6 digits required";
  }
  return errors;
}

function fromParty(party: Party): PartyFormState {
  return {
    party_name: party.party_name ?? party.name ?? "",
    display_name: party.display_name ?? "",
    party_code: party.party_code ?? "",
    party_type: (party.party_type as PartyType) ?? "CUSTOMER",
    party_category: party.party_category ?? "",
    contact_person: party.contact_person ?? "",
    designation: party.designation ?? "",
    mobile: party.mobile ?? party.phone ?? "",
    whatsapp_no: party.whatsapp_no ?? "",
    office_phone: party.office_phone ?? "",
    email: party.email ?? "",
    website: party.website ?? "",
    address_line_1: party.address_line_1 ?? party.address ?? "",
    address_line_2: party.address_line_2 ?? "",
    city: party.city ?? "",
    state: party.state ?? "",
    pincode: party.pincode ?? "",
    country: party.country ?? "India",
    gstin: party.gstin ?? "",
    pan_number: party.pan_number ?? "",
    registration_type: party.registration_type ?? "",
    drug_license_number: party.drug_license_number ?? "",
    fssai_number: party.fssai_number ?? "",
    udyam_number: party.udyam_number ?? "",
    credit_limit: party.credit_limit ?? "0.00",
    payment_terms: party.payment_terms ?? "",
    opening_balance: party.opening_balance ?? "0.00",
    outstanding_tracking_mode: party.outstanding_tracking_mode ?? "BILL_WISE",
    is_active: party.is_active,
  };
}

function FieldShell({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="space-y-2">
      <div className="space-y-1">
        <p className="text-sm font-medium text-[hsl(var(--text-primary))]">{label}</p>
        {hint ? <p className="text-xs text-[hsl(var(--text-secondary))]">{hint}</p> : null}
      </div>
      {children}
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </label>
  );
}

function NativeSelect({
  value,
  onChange,
  children,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-sky-400 dark:focus:ring-sky-400/20"
    >
      {children}
    </select>
  );
}

export function PartiesManager() {
  const { user, hasPermission } = usePermissions();
  const canEdit =
    !!user &&
    (user.is_superuser ||
      hasPermission("party:create") ||
      hasPermission("party:update") ||
      hasPermission("party:bulk_create"));

  const canDeactivate = !!user && (user.is_superuser || hasPermission("party:deactivate"));

  const [viewMode, setViewMode] = useState<ViewMode>("form");
  const [items, setItems] = useState<Party[]>([]);
  const [form, setForm] = useState<PartyFormState>(createEmptyForm);
  const [formErrors, setFormErrors] = useState<ValidationErrors>({});
  const [editingPartyId, setEditingPartyId] = useState<number | null>(null);
  const [gridRows, setGridRows] = useState<GridRow[]>([createEmptyGridRow(1)]);
  const [gridErrors, setGridErrors] = useState<Record<string, ValidationErrors>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nextGridId = useRef(2);
  const gridCellRefs = useRef<Record<string, HTMLElement | null>>({});

  async function loadParties() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.listParties();
      setItems(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load Party Master");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadParties();
  }, []);

  const savedParties = useMemo(
    () => [...items].sort((left, right) => (left.party_name ?? left.name).localeCompare(right.party_name ?? right.name)),
    [items],
  );

  function resetForm() {
    setEditingPartyId(null);
    setForm(createEmptyForm());
    setFormErrors({});
    setSummary(null);
  }

  function ensureTrailingBlankRow(rows: GridRow[]) {
    if (rows.length === 0 || !isGridRowBlank(rows[rows.length - 1]!)) {
      return [...rows, createEmptyGridRow(nextGridId.current++)];
    }
    return rows;
  }

  function updateFormField<K extends keyof PartyFormState>(field: K, value: PartyFormState[K]) {
    setForm((current) => {
      let next = { ...current, [field]: value };
      if (field === "gstin") {
        next = applyGstinIntelligence(next, String(value));
        if (next.gstin && !next.registration_type && GSTIN_PATTERN.test(next.gstin)) {
          next.registration_type = "REGISTERED";
        }
      }
      if (field === "state" && !current.gstin) {
        next.state = String(value);
      }
      return next;
    });
    setFormErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function saveForm() {
    const nextErrors = validateForm(form);
    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSummary("Fix the highlighted Party Master fields before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    setSummary(null);
    try {
      const payload = toPartyPayload(form);
      if (editingPartyId) {
        await apiClient.updateParty(editingPartyId, payload);
        setSummary(`Updated ${form.party_name}.`);
      } else {
        await apiClient.createParty(payload);
        setSummary(`Created ${form.party_name}.`);
      }
      resetForm();
      await loadParties();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save Party Master");
    } finally {
      setSaving(false);
    }
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
        return ensureTrailingBlankRow([...current, newRow]);
      }
      const index = current.findIndex((row) => row.id === afterRowId);
      if (index === -1) {
        return ensureTrailingBlankRow([...current, newRow]);
      }
      const next = [...current];
      next.splice(index + 1, 0, newRow);
      return ensureTrailingBlankRow(next);
    });
    requestAnimationFrame(() => focusGridCell(newRow.id, "party_name"));
  }

  function updateGridRow(rowId: string, patch: Partial<GridRow>) {
    setGridRows((current) =>
      ensureTrailingBlankRow(current.map((row) => (row.id === rowId ? { ...row, ...patch } : row))),
    );
    setGridErrors((current) => ({ ...current, [rowId]: { ...current[rowId], ...Object.fromEntries(Object.keys(patch).map((key) => [key, undefined])) } }));
  }

  function handleGridGstinChange(rowId: string, value: string) {
    setGridRows((current) =>
      ensureTrailingBlankRow(
        current.map((row) => {
          if (row.id !== rowId) {
            return row;
          }
          const next = applyGstinIntelligence(row, value, row.state_overridden);
          return next;
        }),
      ),
    );
    setGridErrors((current) => ({ ...current, [rowId]: { ...current[rowId], gstin: undefined } }));
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

  async function saveGridRows() {
    const candidateRows = gridRows.filter((row) => !isGridRowBlank(row));
    const nextErrors: Record<string, ValidationErrors> = {};
    let hasErrors = false;
    for (const row of candidateRows) {
      const rowValidation = validateGridRow(row);
      if (Object.keys(rowValidation).length > 0) {
        nextErrors[row.id] = rowValidation;
        hasErrors = true;
      }
    }
    setGridErrors(nextErrors);
    if (hasErrors || candidateRows.length === 0) {
      setSummary("Fix the highlighted grid rows before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    setSummary(null);
    try {
      const result = await apiClient.bulkCreateParties({
        rows: candidateRows.map((row) => ({
          party_name: row.party_name.trim(),
          party_type: row.party_type,
          party_category: row.party_category || undefined,
          contact_person: row.contact_person.trim() || undefined,
          mobile: row.mobile.trim() || undefined,
          gstin: row.gstin.trim() || undefined,
          pan_number: row.gstin.trim() ? undefined : row.pan_number.trim() || undefined,
          state: row.state.trim() || undefined,
          city: row.city.trim() || undefined,
          pincode: row.pincode.trim() || undefined,
          drug_license_number: row.drug_license_number.trim() || undefined,
          fssai_number: row.fssai_number.trim() || undefined,
          udyam_number: row.udyam_number.trim() || undefined,
          is_active: row.is_active,
        })),
      });

      if (result.errors.length > 0) {
        const mappedErrors: Record<string, ValidationErrors> = {};
        result.errors.forEach((entry: BulkImportError) => {
          const row = candidateRows[entry.row - 1];
          if (!row) {
            return;
          }
          mappedErrors[row.id] = {
            ...mappedErrors[row.id],
            [entry.field ?? "party_name"]: entry.message,
          };
        });
        setGridErrors(mappedErrors);
      }

      setSummary(`Created ${result.created_count} parties${result.failed_count ? `, ${result.failed_count} failed.` : "."}`);
      setGridRows([createEmptyGridRow(nextGridId.current++)]);
      await loadParties();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save Party Master rows");
    } finally {
      setSaving(false);
    }
  }

  async function deactivateParty(id: number) {
    if (!canDeactivate) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiClient.deactivateParty(id);
      setSummary("Party deactivated.");
      await loadParties();
      if (editingPartyId === id) {
        resetForm();
      }
    } catch (deactivateError) {
      setError(deactivateError instanceof Error ? deactivateError.message : "Failed to deactivate party");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <AppTabs
        tabs={[
          { id: "form", label: "Form View" },
          { id: "grid", label: "Grid View" },
        ]}
        value={viewMode}
        onChange={(value) => setViewMode(value)}
      />

      {viewMode === "form" ? (
        <div className="space-y-6">
          <AppSectionCard
            title={editingPartyId ? "Edit Party Master" : "Create Party Master"}
            description="Maintain customers, suppliers, and dual-role business accounts with GST intelligence and compliance details."
          >
            <AppFormGrid className="xl:grid-cols-3">
              <FieldShell label="Party Name" error={formErrors.party_name}>
                <Input value={form.party_name} onChange={(event) => updateFormField("party_name", event.target.value)} />
              </FieldShell>
              <FieldShell label="Display Name">
                <Input value={form.display_name} onChange={(event) => updateFormField("display_name", event.target.value)} />
              </FieldShell>
              <FieldShell label="Party Code">
                <Input value={form.party_code} onChange={(event) => updateFormField("party_code", event.target.value.toUpperCase())} />
              </FieldShell>
              <FieldShell label="Party Type" error={formErrors.party_type}>
                <NativeSelect value={form.party_type} onChange={(value) => updateFormField("party_type", value as PartyType)}>
                  {partyTypeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </NativeSelect>
              </FieldShell>
              <FieldShell label="Party Category">
                <NativeSelect value={form.party_category} onChange={(value) => updateFormField("party_category", value as PartyCategory | "")}>
                  <option value="">Select category</option>
                  {partyCategoryOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </NativeSelect>
              </FieldShell>
              <FieldShell label="Contact Person">
                <Input value={form.contact_person} onChange={(event) => updateFormField("contact_person", event.target.value)} />
              </FieldShell>
              <FieldShell label="Designation">
                <Input value={form.designation} onChange={(event) => updateFormField("designation", event.target.value)} />
              </FieldShell>
              <FieldShell label="Mobile">
                <Input value={form.mobile} onChange={(event) => updateFormField("mobile", event.target.value)} />
              </FieldShell>
              <FieldShell label="WhatsApp No">
                <Input value={form.whatsapp_no} onChange={(event) => updateFormField("whatsapp_no", event.target.value)} />
              </FieldShell>
            </AppFormGrid>
          </AppSectionCard>

          <AppSectionCard title="Contact & Address">
            <AppFormGrid className="xl:grid-cols-3">
              <FieldShell label="Office Phone">
                <Input value={form.office_phone} onChange={(event) => updateFormField("office_phone", event.target.value)} />
              </FieldShell>
              <FieldShell label="Email" error={formErrors.email}>
                <Input value={form.email} onChange={(event) => updateFormField("email", event.target.value)} />
              </FieldShell>
              <FieldShell label="Website">
                <Input value={form.website} onChange={(event) => updateFormField("website", event.target.value)} />
              </FieldShell>
              <FieldShell label="Address Line 1">
                <Input value={form.address_line_1} onChange={(event) => updateFormField("address_line_1", event.target.value)} />
              </FieldShell>
              <FieldShell label="Address Line 2">
                <Input value={form.address_line_2} onChange={(event) => updateFormField("address_line_2", event.target.value)} />
              </FieldShell>
              <FieldShell label="City">
                <Input value={form.city} onChange={(event) => updateFormField("city", event.target.value)} />
              </FieldShell>
              <FieldShell label="State">
                <Input
                  value={form.state}
                  disabled={Boolean(form.gstin)}
                  onChange={(event) => updateFormField("state", event.target.value)}
                />
              </FieldShell>
              <FieldShell label="PIN Code" error={formErrors.pincode}>
                <Input value={form.pincode} onChange={(event) => updateFormField("pincode", event.target.value)} />
              </FieldShell>
              <FieldShell label="Country">
                <Input value={form.country} onChange={(event) => updateFormField("country", event.target.value)} />
              </FieldShell>
            </AppFormGrid>
          </AppSectionCard>

          <details className="rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card-bg))] p-5 shadow-sm" open>
            <summary className="cursor-pointer text-sm font-semibold text-[hsl(var(--text-primary))]">
              More Details
            </summary>
            <div className="mt-5 space-y-6">
              <AppSectionCard title="Tax & Compliance">
                <AppFormGrid className="xl:grid-cols-3">
                  <FieldShell label="GSTIN" error={formErrors.gstin} hint="Entering GSTIN auto-fills PAN and State.">
                    <Input
                      value={form.gstin}
                      className="uppercase"
                      onChange={(event) => updateFormField("gstin", normalizeGstin(event.target.value))}
                    />
                  </FieldShell>
                  <FieldShell label="PAN">
                    <Input
                      value={form.pan_number}
                      disabled={Boolean(form.gstin)}
                      onChange={(event) => updateFormField("pan_number", event.target.value.toUpperCase())}
                    />
                  </FieldShell>
                  <FieldShell label="Registration Type">
                    <NativeSelect
                      value={form.registration_type}
                      onChange={(value) => updateFormField("registration_type", value as RegistrationType | "")}
                    >
                      <option value="">Select registration</option>
                      {registrationTypeOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </NativeSelect>
                  </FieldShell>
                  <FieldShell label="Drug License Number">
                    <Input value={form.drug_license_number} onChange={(event) => updateFormField("drug_license_number", event.target.value)} />
                  </FieldShell>
                  <FieldShell label="FSSAI Number">
                    <Input value={form.fssai_number} onChange={(event) => updateFormField("fssai_number", event.target.value)} />
                  </FieldShell>
                  <FieldShell label="Udyam Number">
                    <Input value={form.udyam_number} onChange={(event) => updateFormField("udyam_number", event.target.value)} />
                  </FieldShell>
                </AppFormGrid>
              </AppSectionCard>

              <AppSectionCard title="Commercial Details">
                <AppFormGrid className="xl:grid-cols-3">
                  <FieldShell label="Credit Limit" error={formErrors.credit_limit}>
                    <Input value={form.credit_limit} onChange={(event) => updateFormField("credit_limit", event.target.value)} />
                  </FieldShell>
                  <FieldShell label="Payment Terms">
                    <Input value={form.payment_terms} onChange={(event) => updateFormField("payment_terms", event.target.value)} />
                  </FieldShell>
                  <FieldShell label="Opening Balance">
                    <Input value={form.opening_balance} onChange={(event) => updateFormField("opening_balance", event.target.value)} />
                  </FieldShell>
                  <FieldShell label="Outstanding Tracking Mode">
                    <NativeSelect
                      value={form.outstanding_tracking_mode}
                      onChange={(value) => updateFormField("outstanding_tracking_mode", value as OutstandingTrackingMode)}
                    >
                      {outstandingTrackingOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
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
              </AppSectionCard>
            </div>
          </details>

          <AppActionBar>
            <Button type="button" variant="outline" onClick={resetForm}>
              Clear
            </Button>
            <Button type="button" onClick={() => window.open("/api/masters/parties/template.csv", "_blank")}>
              <Download className="mr-2 h-4 w-4" />
              CSV Template
            </Button>
            <Button type="button" onClick={() => void saveForm()} disabled={!canEdit || saving}>
              <Save className="mr-2 h-4 w-4" />
              {editingPartyId ? "Save Changes" : "Create Party"}
            </Button>
          </AppActionBar>
        </div>
      ) : (
        <div className="space-y-6">
          <AppTable
            title="Party Master Grid"
            description="Bulk create customers, suppliers, and compliance-heavy business parties. Press Enter on the last editable cell to add a row, and Ctrl+Enter to save all rows."
            actions={
              <>
                <Button type="button" variant="outline" onClick={() => addGridRow()}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Row
                </Button>
                <Button type="button" variant="outline" onClick={() => window.open("/api/masters/parties/template.csv", "_blank")}>
                  <Download className="mr-2 h-4 w-4" />
                  CSV Template
                </Button>
                <Button type="button" onClick={() => void saveGridRows()} disabled={!canEdit || saving}>
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
                  <TableHead>Party Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Contact Person</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>PAN</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>PIN Code</TableHead>
                  <TableHead>Drug License No</TableHead>
                  <TableHead>FSSAI No</TableHead>
                  <TableHead>Udyam No</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gridRows.map((row, index) => {
                  const errors = gridErrors[row.id] ?? {};
                  return (
                    <TableRow key={row.id} className="align-top">
                      <TableCell>{index + 1}</TableCell>
                      <TableCell className="min-w-[220px]">
                        <Input
                          ref={(element) => registerGridCell(row.id, "party_name", element)}
                          value={row.party_name}
                          onChange={(event) => updateGridRow(row.id, { party_name: event.target.value })}
                          onKeyDown={(event) => handleGridKeyDown(row.id, "party_name", event)}
                          className={cn(errors.party_name && "border-rose-500")}
                        />
                        {errors.party_name ? <p className="mt-1 text-xs text-rose-600">{errors.party_name}</p> : null}
                      </TableCell>
                      <TableCell className="min-w-[150px]">
                        <NativeSelect value={row.party_type} onChange={(value) => updateGridRow(row.id, { party_type: value as PartyType })}>
                          {partyTypeOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </NativeSelect>
                      </TableCell>
                      <TableCell className="min-w-[160px]">
                        <NativeSelect value={row.party_category} onChange={(value) => updateGridRow(row.id, { party_category: value as PartyCategory | "" })}>
                          <option value="">Select</option>
                          {partyCategoryOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </NativeSelect>
                      </TableCell>
                      <TableCell className="min-w-[180px]">
                        <Input
                          ref={(element) => registerGridCell(row.id, "contact_person", element)}
                          value={row.contact_person}
                          onChange={(event) => updateGridRow(row.id, { contact_person: event.target.value })}
                          onKeyDown={(event) => handleGridKeyDown(row.id, "contact_person", event)}
                        />
                      </TableCell>
                      <TableCell className="min-w-[150px]">
                        <Input
                          ref={(element) => registerGridCell(row.id, "mobile", element)}
                          value={row.mobile}
                          onChange={(event) => updateGridRow(row.id, { mobile: event.target.value })}
                          onKeyDown={(event) => handleGridKeyDown(row.id, "mobile", event)}
                          className={cn(errors.mobile && "border-rose-500")}
                        />
                        {errors.mobile ? <p className="mt-1 text-xs text-rose-600">{errors.mobile}</p> : null}
                      </TableCell>
                      <TableCell className="min-w-[170px]">
                        <Input
                          ref={(element) => registerGridCell(row.id, "gstin", element)}
                          value={row.gstin}
                          onChange={(event) => handleGridGstinChange(row.id, event.target.value)}
                          onKeyDown={(event) => handleGridKeyDown(row.id, "gstin", event)}
                          className={cn("uppercase", errors.gstin && "border-rose-500")}
                        />
                        {errors.gstin ? <p className="mt-1 text-xs text-rose-600">{errors.gstin}</p> : null}
                      </TableCell>
                      <TableCell className="min-w-[150px]">
                        <Input
                          ref={(element) => registerGridCell(row.id, "pan_number", element)}
                          value={row.pan_number}
                          disabled={Boolean(row.gstin)}
                          onChange={(event) => updateGridRow(row.id, { pan_number: event.target.value.toUpperCase() })}
                          onKeyDown={(event) => handleGridKeyDown(row.id, "pan_number", event)}
                        />
                      </TableCell>
                      <TableCell className="min-w-[160px]">
                        <Input
                          ref={(element) => registerGridCell(row.id, "state", element)}
                          value={row.state}
                          disabled={Boolean(row.gstin)}
                          onChange={(event) =>
                            updateGridRow(row.id, {
                              state: event.target.value,
                              state_overridden: true,
                            })
                          }
                          onKeyDown={(event) => handleGridKeyDown(row.id, "state", event)}
                        />
                      </TableCell>
                      <TableCell className="min-w-[150px]">
                        <Input
                          ref={(element) => registerGridCell(row.id, "city", element)}
                          value={row.city}
                          onChange={(event) => updateGridRow(row.id, { city: event.target.value })}
                          onKeyDown={(event) => handleGridKeyDown(row.id, "city", event)}
                        />
                      </TableCell>
                      <TableCell className="min-w-[130px]">
                        <Input
                          ref={(element) => registerGridCell(row.id, "pincode", element)}
                          value={row.pincode}
                          onChange={(event) => updateGridRow(row.id, { pincode: event.target.value })}
                          onKeyDown={(event) => handleGridKeyDown(row.id, "pincode", event)}
                          className={cn(errors.pincode && "border-rose-500")}
                        />
                        {errors.pincode ? <p className="mt-1 text-xs text-rose-600">{errors.pincode}</p> : null}
                      </TableCell>
                      <TableCell className="min-w-[160px]">
                        <Input
                          ref={(element) => registerGridCell(row.id, "drug_license_number", element)}
                          value={row.drug_license_number}
                          onChange={(event) => updateGridRow(row.id, { drug_license_number: event.target.value })}
                          onKeyDown={(event) => handleGridKeyDown(row.id, "drug_license_number", event)}
                        />
                      </TableCell>
                      <TableCell className="min-w-[150px]">
                        <Input
                          ref={(element) => registerGridCell(row.id, "fssai_number", element)}
                          value={row.fssai_number}
                          onChange={(event) => updateGridRow(row.id, { fssai_number: event.target.value })}
                          onKeyDown={(event) => handleGridKeyDown(row.id, "fssai_number", event)}
                        />
                      </TableCell>
                      <TableCell className="min-w-[150px]">
                        <Input
                          ref={(element) => registerGridCell(row.id, "udyam_number", element)}
                          value={row.udyam_number}
                          onChange={(event) => updateGridRow(row.id, { udyam_number: event.target.value })}
                          onKeyDown={(event) => handleGridKeyDown(row.id, "udyam_number", event)}
                        />
                      </TableCell>
                      <TableCell className="min-w-[120px]">
                        <NativeSelect value={row.is_active ? "ACTIVE" : "INACTIVE"} onChange={(value) => updateGridRow(row.id, { is_active: value === "ACTIVE" })}>
                          <option value="ACTIVE">Active</option>
                          <option value="INACTIVE">Inactive</option>
                        </NativeSelect>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setGridRows((current) => ensureTrailingBlankRow(current.filter((entry) => entry.id !== row.id)))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </AppTable>
        </div>
      )}

      {summary ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{summary}</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <AppTable title="Saved Party Master Records" description="Customers, suppliers, institutions, and dual-role business accounts in the current tenant.">
        <Table>
          <TableHeader className="sticky top-0 bg-slate-100 dark:bg-slate-900">
            <TableRow>
              <TableHead>Party</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>GSTIN</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-[hsl(var(--text-secondary))]">
                  Loading Party Master records...
                </TableCell>
              </TableRow>
            ) : savedParties.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-[hsl(var(--text-secondary))]">
                  No parties created yet.
                </TableCell>
              </TableRow>
            ) : (
              savedParties.map((party) => (
                <TableRow key={party.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-[hsl(var(--text-primary))]">{party.party_name ?? party.name}</p>
                      <p className="text-xs text-[hsl(var(--text-secondary))]">{party.party_code ?? party.display_name ?? "-"}</p>
                    </div>
                  </TableCell>
                  <TableCell>{party.party_type}</TableCell>
                  <TableCell>{party.party_category ?? "-"}</TableCell>
                  <TableCell>{party.contact_person ?? party.mobile ?? party.phone ?? "-"}</TableCell>
                  <TableCell>{party.gstin ?? "-"}</TableCell>
                  <TableCell>{party.state ?? "-"}</TableCell>
                  <TableCell>{party.is_active ? "Active" : "Inactive"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setViewMode("form");
                          setEditingPartyId(party.id);
                          setForm(fromParty(party));
                          setFormErrors({});
                          setSummary(null);
                        }}
                      >
                        <SquarePen className="mr-2 h-4 w-4" />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!canDeactivate || !party.is_active}
                        onClick={() => void deactivateParty(party.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Deactivate
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </AppTable>
    </div>
  );
}
