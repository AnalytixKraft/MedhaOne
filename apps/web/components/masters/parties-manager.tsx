"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  Download,
  Loader2,
  Save,
  SquarePen,
  Trash2,
  XCircle,
} from "lucide-react";

import { usePermissions } from "@/components/auth/permission-provider";
import {
  AppActionBar,
  AppFormGrid,
  AppTable,
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
  type Category,
  type GSTVerificationSession,
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

const partyTypeOptions: PartyType[] = ["CUSTOMER", "SUPPLIER", "BOTH", "OTHER"];

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
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

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
  drug_license_2_number: string;
  fssai_number: string;
  udyam_number: string;
  credit_limit: string;
  payment_terms: string;
  opening_balance: string;
  outstanding_tracking_mode: OutstandingTrackingMode;
  is_active: boolean;
};

type ValidationErrors = Partial<Record<string, string>>;

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
    drug_license_2_number: "",
    fssai_number: "",
    udyam_number: "",
    credit_limit: "0.00",
    payment_terms: "",
    opening_balance: "0.00",
    outstanding_tracking_mode: "BILL_WISE",
    is_active: true,
  };
}

function formatCategoryLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatVerificationStatusLabel(
  value: Party["drug_license_verified_status"],
) {
  return value.replaceAll("_", " ");
}

function verificationStatusClass(value: Party["drug_license_verified_status"]) {
  switch (value) {
    case "VERIFIED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300";
    case "PENDING_REVIEW":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300";
    case "FAILED":
    case "EXPIRED":
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300";
  }
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function applyGstinIntelligence<
  T extends { gstin: string; pan_number: string; state: string },
>(record: T, rawValue: string, stateOverridden = false): T {
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

function parseGstAddress(adr: string): {
  address_line_1: string;
  city: string;
  pincode: string;
} {
  const parts = adr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const pincode = /^\d{6}$/.test(parts[parts.length - 1] ?? "")
    ? (parts.pop() ?? "")
    : "";
  // The portal orders trailing segments as ..., city, state[, pincode]. State is
  // already derived from the GSTIN, so drop it — but only when another segment
  // remains, so a 1-segment address isn't swallowed and left empty.
  if (parts.length >= 2) parts.pop(); // state
  const city = parts.pop() ?? "";
  const address_line_1 = parts.join(", ");
  return { address_line_1, city, pincode };
}

function mapGstTaxpayerType(dty: string): RegistrationType {
  const lower = dty.toLowerCase();
  if (lower.startsWith("composition")) return "COMPOSITION";
  if (lower.startsWith("sez")) return "SEZ";
  if (lower === "unregistered") return "UNREGISTERED";
  return "REGISTERED";
}

function toPartyPayload(form: PartyFormState): PartyPayload {
  return {
    party_name: form.party_name.trim(),
    display_name: form.display_name.trim() || undefined,
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
    pan_number: form.gstin.trim()
      ? undefined
      : form.pan_number.trim() || undefined,
    registration_type: form.registration_type || undefined,
    drug_license_number: form.drug_license_number.trim() || undefined,
    drug_license_2_number: form.drug_license_2_number.trim() || undefined,
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
  if (form.party_type !== "OTHER") {
    if (!form.gstin.trim()) {
      errors.gstin = "GSTIN is required";
    } else if (!GSTIN_PATTERN.test(form.gstin.trim())) {
      errors.gstin = "Invalid GSTIN format";
    }
  } else if (form.gstin.trim() && !GSTIN_PATTERN.test(form.gstin.trim())) {
    errors.gstin = "Invalid GSTIN format";
  }
  if (form.pincode.trim() && !/^\d{6}$/.test(form.pincode.trim())) {
    errors.pincode = "PIN Code must be 6 digits";
  }
  if (
    form.email.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
  ) {
    errors.email = "Invalid email address";
  }
  if (form.credit_limit.trim() && Number(form.credit_limit) < 0) {
    errors.credit_limit = "Credit limit cannot be negative";
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
    drug_license_2_number: party.drug_license_2_number ?? "",
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
        <p className="text-sm font-medium text-[hsl(var(--text-primary))]">
          {label}
        </p>
        {hint ? (
          <p className="text-xs text-[hsl(var(--text-secondary))]">{hint}</p>
        ) : null}
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

function FormSection({
  title,
  description,
  collapsible = true,
  defaultOpen = true,
  children,
}: {
  title: string;
  description?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const cardClass =
    "overflow-hidden rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card-bg))] text-card-foreground shadow-sm";
  const heading = (
    <div className="space-y-0.5">
      <h3 className="text-base font-semibold text-[hsl(var(--text-primary))]">
        {title}
      </h3>
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
  const body = (
    <div className="space-y-4 p-5 pt-4 md:p-6 md:pt-4">{children}</div>
  );

  if (!collapsible) {
    return (
      <div className={cardClass}>
        <div className="border-b border-border/70 bg-[hsl(var(--muted-bg))] px-5 py-3 md:px-6">
          {heading}
        </div>
        {body}
      </div>
    );
  }

  return (
    <details open={defaultOpen} className={cn("group", cardClass)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 border-b border-transparent bg-[hsl(var(--muted-bg))] px-5 py-3 group-open:border-border/70 md:px-6 [&::-webkit-details-marker]:hidden">
        {heading}
        <ChevronDown
          className="h-4 w-4 shrink-0 text-[hsl(var(--text-secondary))] transition-transform duration-200 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      {body}
    </details>
  );
}

// Inline GST portal captcha — shown when the automatic solver couldn't read it.
// The image and session cookies come back from the backend in the verification
// session; submitting the value resumes (and usually completes) verification.
function GstCaptchaPrompt({
  session,
  value,
  submitting,
  onChange,
  onSubmit,
}: {
  session: GSTVerificationSession;
  value: string;
  submitting: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const ctx = session.log.extracted_data_json as Record<string, unknown> | null;
  const sessionContext =
    ctx &&
    typeof ctx.session_context === "object" &&
    ctx.session_context !== null
      ? (ctx.session_context as Record<string, unknown>)
      : null;
  const captchaImageB64 =
    typeof sessionContext?.captcha_image_b64 === "string"
      ? sessionContext.captcha_image_b64
      : undefined;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
        Enter the GST portal captcha
      </p>
      <p className="mb-3 mt-0.5 text-xs text-amber-700 dark:text-amber-400">
        {session.challenge_text ??
          "Auto-solving couldn't read the captcha. Type the characters shown below to finish verifying."}
      </p>
      {captchaImageB64 ? (
        // eslint-disable-next-line @next/next/no-img-element -- transient base64 captcha data-URI; next/image adds no value here
        <img
          src={`data:image/png;base64,${captchaImageB64}`}
          alt="GST portal captcha"
          className="mb-3 rounded border border-amber-300 bg-white p-1 dark:border-amber-500/50"
        />
      ) : session.log.source_url ? (
        <a
          href={session.log.source_url}
          target="_blank"
          rel="noreferrer"
          className="mb-3 inline-block text-xs font-medium text-amber-800 underline underline-offset-4 dark:text-amber-300"
        >
          Open the GST portal to read the captcha
        </a>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && value.trim() && !submitting) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Enter captcha"
          className="max-w-[200px] uppercase"
        />
        <Button
          type="button"
          onClick={onSubmit}
          disabled={!value.trim() || submitting}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            "Submit captcha"
          )}
        </Button>
      </div>
    </div>
  );
}

export function PartiesManager() {
  const router = useRouter();
  const { user, hasPermission } = usePermissions();
  const canEdit =
    !!user &&
    (user.is_superuser ||
      hasPermission("party:create") ||
      hasPermission("party:update") ||
      hasPermission("party:bulk_create"));

  const canDeactivate =
    !!user && (user.is_superuser || hasPermission("party:deactivate"));
  const canVerifyDrugLicense =
    !!user && (user.is_superuser || hasPermission("drug_license:view"));
  const canVerifyGstin =
    !!user && (user.is_superuser || hasPermission("gst:verify"));

  const [items, setItems] = useState<Party[]>([]);
  const [partyCategories, setPartyCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<PartyFormState>(createEmptyForm);
  const [formErrors, setFormErrors] = useState<ValidationErrors>({});
  const [editingPartyId, setEditingPartyId] = useState<number | null>(null);
  const [editingParty, setEditingParty] = useState<Party | null>(null);
  const formCardRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedPartiesPage, setSavedPartiesPage] = useState(1);
  const [savedPartiesPageSize, setSavedPartiesPageSize] = useState<number>(10);
  const [searchQuery, setSearchQuery] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyingDrugLicense, setVerifyingDrugLicense] = useState(false);
  const [drugLicenseVerifyError, setDrugLicenseVerifyError] = useState<
    string | null
  >(null);
  const [verifyingDrugLicense2, setVerifyingDrugLicense2] = useState(false);
  const [drugLicense2VerifyError, setDrugLicense2VerifyError] = useState<
    string | null
  >(null);
  const [verifyingGstin, setVerifyingGstin] = useState(false);
  const [gstinVerifyError, setGstinVerifyError] = useState<string | null>(null);
  // True only when address fields hold data auto-filled from a successful GST
  // portal verify — used to lock those fields without trapping manual entry.
  const [gstAutofilled, setGstAutofilled] = useState(false);
  // Holds a pending verification session when the portal's auto captcha-solve
  // failed and we need the user to read the captcha image inline.
  const [gstSession, setGstSession] = useState<GSTVerificationSession | null>(
    null,
  );
  const [gstCaptchaValue, setGstCaptchaValue] = useState("");

  async function loadParties(): Promise<Party[]> {
    setLoading(true);
    setError(null);
    try {
      const [parties, categories] = await Promise.all([
        apiClient.listParties(),
        apiClient.listCategories(),
      ]);
      setItems(parties);
      setPartyCategories(categories);
      return parties;
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load Party Master",
      );
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadParties();
  }, []);

  const savedParties = useMemo(
    () =>
      [...items].sort((left, right) =>
        (left.party_name ?? left.name).localeCompare(
          right.party_name ?? right.name,
        ),
      ),
    [items],
  );

  const filteredSavedParties = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return savedParties;
    }

    return savedParties.filter((party) =>
      [
        party.party_name ?? party.name ?? "",
        party.party_code ?? "",
        party.party_type ?? "",
        party.party_category ?? "",
        party.contact_person ?? "",
        party.mobile ?? party.phone ?? "",
        party.gstin ?? "",
        party.state ?? "",
        party.city ?? "",
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [savedParties, searchQuery]);

  const partyCategoryOptions = useMemo(
    () =>
      partyCategories
        .map((category) => category.name)
        .sort((left, right) => left.localeCompare(right)),
    [partyCategories],
  );

  // The actual "Retailer" category name as stored (case-insensitive lookup,
  // falling back to the canonical "RETAILER").
  const retailerCategory =
    partyCategoryOptions.find(
      (option) => option.toUpperCase() === "RETAILER",
    ) ?? "RETAILER";
  const isRetailerCategory =
    form.party_category.trim().toUpperCase() === "RETAILER";
  // GST-verified parties have their name/address pulled from the portal and
  // locked — except Retailers, who may correct their own shop details.
  const gstFieldsLocked = gstAutofilled && !isRetailerCategory;

  // Party type OTHER is always Retailer — enforce it for manual switches and
  // for any legacy record loaded into the form with a different category.
  useEffect(() => {
    if (
      form.party_type === "OTHER" &&
      form.party_category !== retailerCategory
    ) {
      setForm((current) => ({ ...current, party_category: retailerCategory }));
    }
  }, [form.party_type, form.party_category, retailerCategory]);

  const totalSavedPartyPages = Math.max(
    1,
    Math.ceil(filteredSavedParties.length / savedPartiesPageSize),
  );

  const paginatedSavedParties = useMemo(() => {
    const startIndex = (savedPartiesPage - 1) * savedPartiesPageSize;
    return filteredSavedParties.slice(
      startIndex,
      startIndex + savedPartiesPageSize,
    );
  }, [filteredSavedParties, savedPartiesPage, savedPartiesPageSize]);

  useEffect(() => {
    setSavedPartiesPage(1);
  }, [savedPartiesPageSize, searchQuery]);

  useEffect(() => {
    if (savedPartiesPage > totalSavedPartyPages) {
      setSavedPartiesPage(totalSavedPartyPages);
    }
  }, [savedPartiesPage, totalSavedPartyPages]);

  function resetForm() {
    setEditingPartyId(null);
    setEditingParty(null);
    setForm(createEmptyForm());
    setFormErrors({});
    setGstAutofilled(false);
    setGstSession(null);
    setGstCaptchaValue("");
    setGstinVerifyError(null);
    setSummary(null);
  }

  function beginFormEdit(party: Party) {
    setEditingPartyId(party.id);
    setEditingParty(party);
    setForm(fromParty(party));
    setFormErrors({});
    // Only treat the loaded address as portal-derived (locked) if this party was
    // actually GST-verified; otherwise leave the fields editable.
    setGstAutofilled(party.gst_verified_status === "VERIFIED");
    setGstSession(null);
    setGstCaptchaValue("");
    setGstinVerifyError(null);
    setSummary(null);
    // Bring the auto-filled form into view — the table can be far below it.
    formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function updateFormField<K extends keyof PartyFormState>(
    field: K,
    value: PartyFormState[K],
  ) {
    setForm((current) => {
      let next = { ...current, [field]: value };
      if (field === "gstin") {
        next = applyGstinIntelligence(next, String(value));
        if (
          next.gstin &&
          !next.registration_type &&
          GSTIN_PATTERN.test(next.gstin)
        ) {
          next.registration_type = "REGISTERED";
        }
      }
      if (field === "state" && !current.gstin) {
        next.state = String(value);
      }
      if (field === "party_type" && value === "OTHER") {
        // OTHER parties carry no GSTIN — drop it and the GSTIN-derived fields so
        // none stay locked and no stale GSTIN is submitted to the backend. Their
        // only valid category is Retailer.
        next.gstin = "";
        next.pan_number = "";
        next.registration_type = "";
        next.party_category = retailerCategory;
      }
      return next;
    });
    if (field === "gstin" || (field === "party_type" && value === "OTHER")) {
      // Editing the GSTIN (or dropping it for OTHER) invalidates any prior portal
      // auto-fill, so re-enable the address fields until the next successful Verify.
      setGstAutofilled(false);
      // Any pending captcha challenge is tied to the old GSTIN — discard it.
      setGstSession(null);
      setGstCaptchaValue("");
    }
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
      const savedId = editingPartyId;
      resetForm();
      const refreshed = await loadParties();
      if (savedId) {
        const updated = refreshed.find((p) => p.id === savedId) ?? null;
        if (updated) setEditingParty(updated);
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save Party Master",
      );
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
      setError(
        deactivateError instanceof Error
          ? deactivateError.message
          : "Failed to deactivate party",
      );
    } finally {
      setSaving(false);
    }
  }

  // Verifies either drug licence slot against the SFDA portal and saves the
  // result back to the matching party columns. Slot 1 and slot 2 share this
  // path, differing only by which number field and verify state they use.
  async function verifyDrugLicense(slot: 1 | 2 = 1) {
    if (!canVerifyDrugLicense) {
      return;
    }

    const licenseNumber =
      slot === 2 ? form.drug_license_2_number : form.drug_license_number;
    const setVerifying =
      slot === 2 ? setVerifyingDrugLicense2 : setVerifyingDrugLicense;
    const setVerifyError =
      slot === 2 ? setDrugLicense2VerifyError : setDrugLicenseVerifyError;

    setVerifying(true);
    setVerifyError(null);

    let partyId = editingPartyId;

    // If creating a new party, save it first to get a party ID
    if (!partyId) {
      const nextErrors = validateForm(form);
      setFormErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) {
        setVerifyError("Fix the form errors above before verifying.");
        setVerifying(false);
        return;
      }
      try {
        const created = await apiClient.createParty(toPartyPayload(form));
        partyId = created.id;
        setEditingPartyId(created.id);
        setEditingParty(created);
        setItems((current) => [...current, created]);
        setSummary(`Created ${form.party_name}. Now verifying drug licence...`);
      } catch (saveError) {
        setVerifyError(
          saveError instanceof Error
            ? saveError.message
            : "Failed to save party before verification",
        );
        setVerifying(false);
        return;
      }
    }

    try {
      const session = await apiClient.startDrugLicenseVerification({
        party_id: partyId,
        drug_license_number: licenseNumber.trim() || undefined,
      });
      if (session.log.status === "CAPTCHA_REQUIRED") {
        setVerifyError(
          "Captcha required — could not auto-verify. Use the Drug Licence Verification screen to complete verification manually.",
        );
        return;
      }
      if (!session.can_save) {
        setVerifyError(
          session.log.remarks ??
            "Verification failed. Check the Drug Licence Verification screen for details.",
        );
        return;
      }
      const updatedParty = await apiClient.saveDrugLicenseVerification(
        session.log.id,
        { slot },
      );
      setEditingParty(updatedParty);
      setItems((current) =>
        current.map((p) => (p.id === updatedParty.id ? updatedParty : p)),
      );
    } catch (verifyError) {
      setVerifyError(
        verifyError instanceof Error
          ? verifyError.message
          : "Verification failed",
      );
    } finally {
      setVerifying(false);
    }
  }

  // Shared success path for both auto-solve and manual-captcha verification:
  // populate the form from verified GST data, lock name/address, and persist to
  // an existing party when possible.
  async function applyGstSuccess(session: GSTVerificationSession) {
    const result = session.result;
    if (!result) return;

    setForm((current) => {
      const updates: Partial<PartyFormState> = {};
      // Verification is authoritative — populate the legal name even if the user
      // had typed something different.
      const name = result.legal_name || result.trade_name;
      if (name) updates.party_name = name;
      if (result.taxpayer_type) {
        updates.registration_type = mapGstTaxpayerType(result.taxpayer_type);
      }
      if (result.principal_address) {
        const parsed = parseGstAddress(result.principal_address);
        if (parsed.address_line_1)
          updates.address_line_1 = parsed.address_line_1;
        if (parsed.city) updates.city = parsed.city;
        if (parsed.pincode) updates.pincode = parsed.pincode;
      }
      return { ...current, ...updates };
    });
    // Portal data is now in the name/address fields — lock them against edits.
    setGstAutofilled(true);
    setGstSession(null);
    setGstCaptchaValue("");
    // If there's an existing party, save the verified data to it. Keep this in
    // its own try/catch: verification already succeeded, so a save failure
    // (e.g. missing gst:save_verified_data permission) must not be reported as
    // a verification failure.
    if (editingPartyId && session.can_save) {
      try {
        const updatedParty = await apiClient.saveGSTVerification(
          session.log.id,
          {},
        );
        setEditingParty(updatedParty);
        setItems((current) =>
          current.map((p) => (p.id === updatedParty.id ? updatedParty : p)),
        );
        setSummary("GSTIN verified successfully.");
      } catch {
        setSummary(
          "GSTIN verified — details auto-filled, but couldn't be saved to the party automatically. Review and Save to persist.",
        );
      }
    } else {
      setSummary(
        "GSTIN verified — details auto-filled. Save the party to complete.",
      );
    }
  }

  async function verifyGstin() {
    if (!canVerifyGstin || !form.gstin.trim()) return;

    setVerifyingGstin(true);
    setGstinVerifyError(null);
    setGstSession(null);
    setGstCaptchaValue("");

    try {
      // Verify first (party_id is optional — no need to save before verifying)
      const session = await apiClient.startGSTVerification({
        party_id: editingPartyId ?? undefined,
        gstin: form.gstin.trim(),
      });
      if (session.result) {
        await applyGstSuccess(session);
      } else if (session.log.status === "CAPTCHA_REQUIRED") {
        // Auto-solve failed — surface the portal captcha inline so the user can
        // read it and finish verifying without leaving the screen.
        setGstSession(session);
      } else {
        setGstinVerifyError(
          session.log.remarks ?? "GSTIN verification failed.",
        );
      }
    } catch (verifyError) {
      setGstinVerifyError(
        verifyError instanceof Error
          ? verifyError.message
          : "GSTIN verification failed",
      );
    } finally {
      setVerifyingGstin(false);
    }
  }

  // Submit the manually-read captcha for the pending verification session.
  async function submitGstCaptcha() {
    if (!gstSession || !gstCaptchaValue.trim()) return;

    setVerifyingGstin(true);
    setGstinVerifyError(null);

    try {
      const session = await apiClient.resumeGSTVerification(gstSession.log.id, {
        captcha_value: gstCaptchaValue.trim(),
      });
      if (session.result) {
        await applyGstSuccess(session);
      } else if (session.log.status === "CAPTCHA_REQUIRED") {
        // Wrong captcha (or a freshly issued one) — show the new image to retry.
        setGstSession(session);
        setGstCaptchaValue("");
        setGstinVerifyError("Captcha didn't match — try the new image below.");
      } else {
        setGstSession(null);
        setGstinVerifyError(
          session.log.remarks ?? "GSTIN verification failed.",
        );
      }
    } catch (resumeError) {
      setGstinVerifyError(
        resumeError instanceof Error
          ? resumeError.message
          : "GSTIN verification failed",
      );
    } finally {
      setVerifyingGstin(false);
    }
  }

  return (
    <div className="space-y-6">
      <div ref={formCardRef} className="space-y-6 scroll-mt-6">
        <FormSection
          title={editingPartyId ? "Edit Party" : "Create Party"}
          collapsible={false}
        >
          <AppFormGrid className="xl:grid-cols-3">
            {/* Party Type is always first */}
            <FieldShell label="Party Type" error={formErrors.party_type}>
              <NativeSelect
                value={form.party_type}
                onChange={(value) =>
                  updateFormField("party_type", value as PartyType)
                }
              >
                {partyTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </NativeSelect>
            </FieldShell>

            {/* GSTIN with Verify — shown and required for all types except OTHER */}
            {form.party_type !== "OTHER" ? (
              <FieldShell
                label="GSTIN"
                error={formErrors.gstin ?? gstinVerifyError ?? undefined}
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={form.gstin}
                    className="uppercase"
                    maxLength={15}
                    onChange={(event) => {
                      updateFormField(
                        "gstin",
                        normalizeGstin(event.target.value),
                      );
                      setGstinVerifyError(null);
                    }}
                  />
                  {canVerifyGstin && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        verifyingGstin || !GSTIN_PATTERN.test(form.gstin)
                      }
                      onClick={() => void verifyGstin()}
                      className="shrink-0"
                      aria-label={
                        verifyingGstin ? "Verifying GSTIN" : "Verify GSTIN"
                      }
                    >
                      {verifyingGstin ? (
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        "Verify"
                      )}
                    </Button>
                  )}
                  {editingParty?.gst_verified_status === "VERIFIED" &&
                    !verifyingGstin && (
                      <CheckCircle2
                        role="img"
                        aria-label="GSTIN verified"
                        className="h-5 w-5 shrink-0 text-emerald-500"
                      />
                    )}
                  {editingParty?.gst_verified_status === "FAILED" &&
                    !verifyingGstin && (
                      <XCircle
                        role="img"
                        aria-label="GSTIN verification failed"
                        className="h-5 w-5 shrink-0 text-rose-500"
                      />
                    )}
                </div>
              </FieldShell>
            ) : (
              /* Party Name for OTHER type where GSTIN is absent */
              <FieldShell label="Party Name" error={formErrors.party_name}>
                <Input
                  value={form.party_name}
                  onChange={(event) =>
                    updateFormField("party_name", event.target.value)
                  }
                />
              </FieldShell>
            )}

            <FieldShell
              label="Party Category"
              hint={
                form.party_type === "OTHER"
                  ? "Party type OTHER is always Retailer."
                  : undefined
              }
            >
              <NativeSelect
                value={form.party_category}
                disabled={form.party_type === "OTHER"}
                onChange={(value) =>
                  updateFormField("party_category", value as PartyCategory | "")
                }
              >
                {form.party_type === "OTHER" ? (
                  <option value={retailerCategory}>
                    {formatCategoryLabel(retailerCategory)}
                  </option>
                ) : (
                  <>
                    <option value="">Select category</option>
                    {partyCategoryOptions.map((option) => (
                      <option key={option} value={option}>
                        {formatCategoryLabel(option)}
                      </option>
                    ))}
                  </>
                )}
              </NativeSelect>
            </FieldShell>

            {/* Party Name — shown after GSTIN for non-OTHER (auto-filled from verify) */}
            {form.party_type !== "OTHER" && (
              <FieldShell label="Party Name" error={formErrors.party_name}>
                <Input
                  value={form.party_name}
                  disabled={gstFieldsLocked}
                  onChange={(event) =>
                    updateFormField("party_name", event.target.value)
                  }
                />
              </FieldShell>
            )}

            <FieldShell label="Display Name">
              <Input
                value={form.display_name}
                onChange={(event) =>
                  updateFormField("display_name", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="Contact Person">
              <Input
                value={form.contact_person}
                onChange={(event) =>
                  updateFormField("contact_person", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="Designation">
              <Input
                value={form.designation}
                onChange={(event) =>
                  updateFormField("designation", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="Mobile">
              <Input
                value={form.mobile}
                onChange={(event) =>
                  updateFormField("mobile", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="WhatsApp No">
              <Input
                value={form.whatsapp_no}
                onChange={(event) =>
                  updateFormField("whatsapp_no", event.target.value)
                }
              />
            </FieldShell>
          </AppFormGrid>
          {gstSession ? (
            <GstCaptchaPrompt
              session={gstSession}
              value={gstCaptchaValue}
              submitting={verifyingGstin}
              onChange={setGstCaptchaValue}
              onSubmit={() => void submitGstCaptcha()}
            />
          ) : null}
        </FormSection>

        <FormSection
          title="Contact & Address"
          description={
            form.gstin && GSTIN_PATTERN.test(form.gstin)
              ? "Address fields are auto-populated from GSTIN on Verify."
              : undefined
          }
        >
          <AppFormGrid className="xl:grid-cols-3">
            <FieldShell label="Address Line 1">
              <Input
                value={form.address_line_1}
                disabled={gstFieldsLocked}
                onChange={(event) =>
                  updateFormField("address_line_1", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="Address Line 2">
              <Input
                value={form.address_line_2}
                onChange={(event) =>
                  updateFormField("address_line_2", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="City">
              <Input
                value={form.city}
                disabled={gstFieldsLocked}
                onChange={(event) =>
                  updateFormField("city", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="State">
              <Input
                value={form.state}
                disabled={gstFieldsLocked}
                onChange={(event) =>
                  updateFormField("state", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="PIN Code" error={formErrors.pincode}>
              <Input
                value={form.pincode}
                disabled={gstFieldsLocked}
                onChange={(event) =>
                  updateFormField("pincode", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="Country">
              <Input
                value={form.country}
                onChange={(event) =>
                  updateFormField("country", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="Office Phone">
              <Input
                value={form.office_phone}
                onChange={(event) =>
                  updateFormField("office_phone", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="Email" error={formErrors.email}>
              <Input
                value={form.email}
                onChange={(event) =>
                  updateFormField("email", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="Website">
              <Input
                value={form.website}
                onChange={(event) =>
                  updateFormField("website", event.target.value)
                }
              />
            </FieldShell>
          </AppFormGrid>
        </FormSection>

        <FormSection title="Tax & Compliance">
          <AppFormGrid className="xl:grid-cols-3">
            <FieldShell label="PAN">
              <Input
                value={form.pan_number}
                disabled={GSTIN_PATTERN.test(form.gstin)}
                onChange={(event) =>
                  updateFormField(
                    "pan_number",
                    event.target.value.toUpperCase(),
                  )
                }
              />
            </FieldShell>
            <FieldShell label="Registration Type">
              <NativeSelect
                value={form.registration_type}
                disabled={GSTIN_PATTERN.test(form.gstin)}
                onChange={(value) =>
                  updateFormField(
                    "registration_type",
                    value as RegistrationType | "",
                  )
                }
              >
                <option value="">Select registration</option>
                {registrationTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </NativeSelect>
            </FieldShell>
            <FieldShell
              label="Drug License Number"
              error={drugLicenseVerifyError ?? undefined}
            >
              <div className="flex items-center gap-2">
                <Input
                  value={form.drug_license_number}
                  onChange={(event) => {
                    updateFormField("drug_license_number", event.target.value);
                    setDrugLicenseVerifyError(null);
                  }}
                />
                {canVerifyDrugLicense && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      verifyingDrugLicense || !form.drug_license_number.trim()
                    }
                    onClick={() => void verifyDrugLicense()}
                    className="shrink-0"
                  >
                    {verifyingDrugLicense ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Verify"
                    )}
                  </Button>
                )}
                {editingParty?.drug_license_verified_status === "VERIFIED" &&
                  !verifyingDrugLicense && (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                  )}
                {(editingParty?.drug_license_verified_status === "FAILED" ||
                  editingParty?.drug_license_verified_status === "EXPIRED") &&
                  !verifyingDrugLicense && (
                    <XCircle className="h-5 w-5 shrink-0 text-rose-500" />
                  )}
              </div>
            </FieldShell>
            <FieldShell
              label="Drug License Number 2"
              error={drugLicense2VerifyError ?? undefined}
            >
              <div className="flex items-center gap-2">
                <Input
                  value={form.drug_license_2_number}
                  onChange={(event) => {
                    updateFormField(
                      "drug_license_2_number",
                      event.target.value,
                    );
                    setDrugLicense2VerifyError(null);
                  }}
                />
                {canVerifyDrugLicense && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      verifyingDrugLicense2 ||
                      !form.drug_license_2_number.trim()
                    }
                    onClick={() => void verifyDrugLicense(2)}
                    className="shrink-0"
                  >
                    {verifyingDrugLicense2 ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Verify"
                    )}
                  </Button>
                )}
                {editingParty?.drug_license_2_verified_status === "VERIFIED" &&
                  !verifyingDrugLicense2 && (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                  )}
                {(editingParty?.drug_license_2_verified_status === "FAILED" ||
                  editingParty?.drug_license_2_verified_status ===
                    "EXPIRED") &&
                  !verifyingDrugLicense2 && (
                    <XCircle className="h-5 w-5 shrink-0 text-rose-500" />
                  )}
              </div>
            </FieldShell>
            <FieldShell label="FSSAI Number">
              <Input
                value={form.fssai_number}
                onChange={(event) =>
                  updateFormField("fssai_number", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="Udyam Number">
              <Input
                value={form.udyam_number}
                onChange={(event) =>
                  updateFormField("udyam_number", event.target.value)
                }
              />
            </FieldShell>
          </AppFormGrid>
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-[hsl(var(--text-primary))]">
                Drug Licence · Portal Data
              </p>
              <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                Read-only · Auto-populated from SFDA portal
              </span>
            </div>
            {editingParty?.drug_license_raw_snapshot ? (
              <textarea
                readOnly
                value={JSON.stringify(
                  editingParty.drug_license_raw_snapshot,
                  null,
                  2,
                )}
                rows={8}
                className="w-full cursor-not-allowed rounded-xl border border-input bg-[hsl(var(--muted-bg))] px-3 py-2 font-mono text-xs text-[hsl(var(--text-secondary))] shadow-inner outline-none"
              />
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-400 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500">
                No portal data yet — click Verify next to Drug License Number to
                auto-populate.
              </p>
            )}
          </div>
          {editingParty?.drug_license_2_raw_snapshot ? (
            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-[hsl(var(--text-primary))]">
                  Drug Licence 2 · Portal Data
                </p>
                <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  Read-only · Auto-populated from SFDA portal
                </span>
              </div>
              <textarea
                readOnly
                value={JSON.stringify(
                  editingParty.drug_license_2_raw_snapshot,
                  null,
                  2,
                )}
                rows={8}
                className="w-full cursor-not-allowed rounded-xl border border-input bg-[hsl(var(--muted-bg))] px-3 py-2 font-mono text-xs text-[hsl(var(--text-secondary))] shadow-inner outline-none"
              />
            </div>
          ) : null}
          {canVerifyGstin && editingParty?.gst_raw_snapshot && (
            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-[hsl(var(--text-primary))]">
                  GST · Portal Data
                </p>
                <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  Read-only · Auto-populated from GST portal
                </span>
              </div>
              <textarea
                readOnly
                value={JSON.stringify(editingParty.gst_raw_snapshot, null, 2)}
                rows={8}
                className="w-full cursor-not-allowed rounded-xl border border-input bg-[hsl(var(--muted-bg))] px-3 py-2 font-mono text-xs text-[hsl(var(--text-secondary))] shadow-inner outline-none"
              />
            </div>
          )}
        </FormSection>

        <FormSection title="Commercial Details" defaultOpen={false}>
          <AppFormGrid className="xl:grid-cols-3">
            <FieldShell label="Credit Limit" error={formErrors.credit_limit}>
              <Input
                value={form.credit_limit}
                onChange={(event) =>
                  updateFormField("credit_limit", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="Payment Terms">
              <Input
                value={form.payment_terms}
                onChange={(event) =>
                  updateFormField("payment_terms", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="Opening Balance">
              <Input
                value={form.opening_balance}
                onChange={(event) =>
                  updateFormField("opening_balance", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="Outstanding Tracking Mode">
              <NativeSelect
                value={form.outstanding_tracking_mode}
                onChange={(value) =>
                  updateFormField(
                    "outstanding_tracking_mode",
                    value as OutstandingTrackingMode,
                  )
                }
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
                onChange={(value) =>
                  updateFormField("is_active", value === "ACTIVE")
                }
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </NativeSelect>
            </FieldShell>
          </AppFormGrid>
        </FormSection>

        <AppActionBar>
          <Button type="button" variant="outline" onClick={resetForm}>
            Clear
          </Button>
          <Button
            type="button"
            onClick={() =>
              window.open("/api/masters/parties/template.csv", "_blank")
            }
          >
            <Download className="mr-2 h-4 w-4" />
            CSV Template
          </Button>
          <Button
            type="button"
            onClick={() => void saveForm()}
            disabled={!canEdit || saving}
          >
            <Save className="mr-2 h-4 w-4" />
            {editingPartyId ? "Save Changes" : "Create Party"}
          </Button>
        </AppActionBar>
      </div>

      {summary ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-300">
          {summary}
        </p>
      ) : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <AppTable
        title="Saved Party Master Records"
        description="Search parties and click Edit to load them into the form above."
        actions={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by party, code, GSTIN, contact, state"
              className="w-full sm:w-80"
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Rows</span>
              <select
                value={savedPartiesPageSize}
                onChange={(event) => {
                  setSavedPartiesPageSize(Number(event.target.value));
                  setSavedPartiesPage(1);
                }}
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
        <Table>
          <TableHeader className="sticky top-0 bg-slate-100 dark:bg-slate-900">
            <TableRow>
              <TableHead className="sticky left-0 z-10 bg-slate-100 dark:bg-slate-900">
                Action
              </TableHead>
              <TableHead>Party</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>GSTIN</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Drug License No</TableHead>
              <TableHead>Drug License No 2</TableHead>
              <TableHead>FSSAI No</TableHead>
              <TableHead>Udyam No</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={12}
                  className="py-10 text-center text-sm text-[hsl(var(--text-secondary))]"
                >
                  Loading Party Master records...
                </TableCell>
              </TableRow>
            ) : filteredSavedParties.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={12}
                  className="py-10 text-center text-sm text-[hsl(var(--text-secondary))]"
                >
                  No parties match your search.
                </TableCell>
              </TableRow>
            ) : (
              paginatedSavedParties.map((party) => (
                <TableRow key={party.id} className="align-top">
                  <TableCell className="sticky left-0 z-[1] min-w-[92px] bg-white dark:bg-slate-950">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() => beginFormEdit(party)}
                        aria-label="Edit party"
                        title="Edit"
                      >
                        <SquarePen className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        disabled={!canVerifyDrugLicense}
                        onClick={() =>
                          router.push(
                            `/masters/drug-license-verification?partyId=${party.id}`,
                          )
                        }
                        aria-label="Verify drug licence"
                        title="Verify Drug Licence"
                      >
                        <BadgeCheck className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={!canDeactivate || !party.is_active}
                        onClick={() => void deactivateParty(party.id)}
                        aria-label="Deactivate party"
                        title="Deactivate"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-[220px]">
                    <div>
                      <p className="font-medium text-[hsl(var(--text-primary))]">
                        {party.party_name ?? party.name}
                      </p>
                      <p className="text-xs text-[hsl(var(--text-secondary))]">
                        {party.party_code ?? party.display_name ?? "-"}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-[150px]">
                    {party.party_type}
                  </TableCell>
                  <TableCell className="min-w-[180px]">
                    {party.party_category
                      ? formatCategoryLabel(party.party_category)
                      : "-"}
                  </TableCell>
                  <TableCell className="min-w-[180px]">
                    {party.contact_person ?? party.mobile ?? party.phone ?? "-"}
                  </TableCell>
                  <TableCell className="min-w-[180px]">
                    {party.gstin ?? "-"}
                  </TableCell>
                  <TableCell className="min-w-[180px]">
                    {party.state ?? "-"}
                  </TableCell>
                  <TableCell className="min-w-[170px]">
                    <div className="space-y-2">
                      <p>{party.drug_license_number ?? "-"}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                            verificationStatusClass(
                              party.drug_license_verified_status,
                            ),
                          )}
                        >
                          {formatVerificationStatusLabel(
                            party.drug_license_verified_status,
                          )}
                        </span>
                        <span className="text-xs text-[hsl(var(--text-secondary))]">
                          Last verified{" "}
                          {formatDateTime(party.drug_license_verified_at)}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-[170px]">
                    {party.drug_license_2_number ? (
                      <div className="space-y-2">
                        <p>{party.drug_license_2_number}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                              verificationStatusClass(
                                party.drug_license_2_verified_status,
                              ),
                            )}
                          >
                            {formatVerificationStatusLabel(
                              party.drug_license_2_verified_status,
                            )}
                          </span>
                          <span className="text-xs text-[hsl(var(--text-secondary))]">
                            Last verified{" "}
                            {formatDateTime(party.drug_license_2_verified_at)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="min-w-[170px]">
                    {party.fssai_number ?? "-"}
                  </TableCell>
                  <TableCell className="min-w-[170px]">
                    {party.udyam_number ?? "-"}
                  </TableCell>
                  <TableCell className="min-w-[120px]">
                    {party.is_active ? "Active" : "Inactive"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {!loading && filteredSavedParties.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-border px-4 py-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
            <span>
              Showing {(savedPartiesPage - 1) * savedPartiesPageSize + 1}
              {" - "}
              {Math.min(
                savedPartiesPage * savedPartiesPageSize,
                filteredSavedParties.length,
              )}
              {" of "}
              {filteredSavedParties.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSavedPartiesPage((current) => Math.max(1, current - 1))
                }
                disabled={savedPartiesPage === 1}
              >
                Previous
              </Button>
              <span className="min-w-24 text-center">
                Page {savedPartiesPage} of {totalSavedPartyPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSavedPartiesPage((current) =>
                    Math.min(totalSavedPartyPages, current + 1),
                  )
                }
                disabled={savedPartiesPage >= totalSavedPartyPages}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </AppTable>
    </div>
  );
}
