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
  address_line_2: string;
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
  // Split the building/street/locality segments across both lines so neither
  // line is overloaded: first half -> line 1, remainder -> line 2.
  const mid = Math.ceil(parts.length / 2);
  const address_line_1 = parts.slice(0, mid).join(", ");
  const address_line_2 = parts.slice(mid).join(", ");
  return { address_line_1, address_line_2, city, pincode };
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
  const isRetailer = form.party_category.trim().toUpperCase() === "RETAILER";
  if (!isRetailer) {
    if (!form.gstin.trim()) {
      errors.gstin = "GSTIN is required for non-retailer parties";
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
      {error ? (
        <p className="text-xs text-rose-700 dark:text-rose-400">{error}</p>
      ) : null}
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
      className="flex h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
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
  const [formTab, setFormTab] = useState<"contact" | "tax" | "commercial">("contact");
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
  // Log id of a GST verification completed this session — used to persist the
  // VERIFIED status when saving, and to gate Save for non-retailers.
  const [verifiedLogId, setVerifiedLogId] = useState<number | null>(null);
  // Drug-licence verification completed this session (persisted on save).
  const [drugVerifiedLogId, setDrugVerifiedLogId] = useState<number | null>(null);
  // Expiry date from the latest drug-licence verification (display only).
  const [drugVerifiedExpiry, setDrugVerifiedExpiry] = useState<string | null>(null);
  // Holder/firm name from the latest drug-licence verification (display only).
  const [drugVerifiedHolder, setDrugVerifiedHolder] = useState<string | null>(null);
  // Second drug-licence verification completed this session (persisted on save).
  const [drugVerified2LogId, setDrugVerified2LogId] = useState<number | null>(null);
  const [drugVerified2Expiry, setDrugVerified2Expiry] = useState<string | null>(null);
  const [drugVerified2Holder, setDrugVerified2Holder] = useState<string | null>(null);
  // GST status & taxpayer type from the latest GST verification (display only).
  const [gstVerifiedStatus, setGstVerifiedStatus] = useState<string | null>(null);
  const [gstVerifiedTaxpayer, setGstVerifiedTaxpayer] = useState<string | null>(null);
  // Reveal the optional second drug licence only on demand.
  const [showSecondDrugLicense, setShowSecondDrugLicense] = useState(false);
  // GST additional places of business (display only) + show/hide toggle.
  const [gstVerifiedAdditional, setGstVerifiedAdditional] = useState<string | null>(null);
  const [showAdditionalAddresses, setShowAdditionalAddresses] = useState(true);
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

  const partyCategoryOptions = useMemo(() => {
    const pt = form.party_type;
    return partyCategories
      .filter((category) => {
        // BOTH / OTHER party types are not restricted by category links.
        if (pt === "BOTH" || pt === "OTHER") return true;
        const linked = (category.party_types ?? []).map((t) => t.toUpperCase());
        // Empty links = unrestricted; otherwise the type must be linked.
        return linked.length === 0 || linked.includes(pt);
      })
      .map((category) => category.name)
      .sort((left, right) => left.localeCompare(right));
  }, [partyCategories, form.party_type]);

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
  // Non-retailers must be GST-verified before Save: either verified this session,
  // or the loaded party is VERIFIED and its GSTIN hasn't been edited since.
  const gstVerified =
    verifiedLogId != null ||
    (editingParty != null &&
      editingParty.gst_verified_status === "VERIFIED" &&
      form.gstin.trim().toUpperCase() ===
        (editingParty.gstin ?? "").toUpperCase());
  const requiresGstVerification = !isRetailerCategory && !gstVerified;
  // Drug-licence expiry to display (verified this session, or stored on the party).
  const drugLicenseExpiryValue =
    drugVerifiedExpiry ?? editingParty?.drug_license_valid_upto ?? null;
  const drugLicenseExpiryDisplay = drugLicenseExpiryValue
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
        new Date(drugLicenseExpiryValue),
      )
    : "";
  const drugLicenseHolderDisplay =
    drugVerifiedHolder ?? editingParty?.drug_license_holder_name ?? "";
  const drugLicense2ExpiryValue =
    drugVerified2Expiry ?? editingParty?.drug_license_2_valid_upto ?? null;
  const drugLicense2ExpiryDisplay = drugLicense2ExpiryValue
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
        new Date(drugLicense2ExpiryValue),
      )
    : "";
  const drugLicense2HolderDisplay =
    drugVerified2Holder ?? editingParty?.drug_license_2_holder_name ?? "";
  const gstStatusDisplay = gstVerifiedStatus ?? editingParty?.gst_status ?? "";
  const gstTaxpayerDisplay =
    gstVerifiedTaxpayer ?? editingParty?.gst_taxpayer_type ?? "";
  const additionalAddressesDisplay =
    gstVerifiedAdditional ?? editingParty?.gst_additional_addresses ?? "";

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
    setFormTab("contact");
    setGstAutofilled(false);
    setShowSecondDrugLicense(false);
    setVerifiedLogId(null);
    setDrugVerifiedLogId(null);
    setDrugVerifiedExpiry(null);
    setDrugVerifiedHolder(null);
    setDrugVerified2LogId(null);
    setDrugVerified2Expiry(null);
    setDrugVerified2Holder(null);
    setGstVerifiedStatus(null);
    setGstVerifiedTaxpayer(null);
    setGstVerifiedAdditional(null);
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
    setFormTab("contact");
    // Only treat the loaded address as portal-derived (locked) if this party was
    // actually GST-verified; otherwise leave the fields editable.
    setGstAutofilled(party.gst_verified_status === "VERIFIED");
    setShowSecondDrugLicense(!!party.drug_license_2_number);
    setVerifiedLogId(null);
    setDrugVerifiedLogId(null);
    setDrugVerifiedExpiry(null);
    setDrugVerifiedHolder(null);
    setDrugVerified2LogId(null);
    setDrugVerified2Expiry(null);
    setDrugVerified2Holder(null);
    setGstVerifiedStatus(null);
    setGstVerifiedTaxpayer(null);
    setGstVerifiedAdditional(null);
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
      if (field === "party_type" && value !== "OTHER" && next.party_category) {
        // Clear the category if it isn't linked to the newly selected party type.
        const pt = String(value).toUpperCase();
        const cat = partyCategories.find(
          (c) => c.name.toUpperCase() === next.party_category.toUpperCase(),
        );
        const linked = (cat?.party_types ?? []).map((t) => t.toUpperCase());
        if (pt !== "BOTH" && linked.length > 0 && !linked.includes(pt)) {
          next.party_category = "";
        }
      }
      return next;
    });
    if (field === "gstin" || (field === "party_type" && value === "OTHER")) {
      // Editing the GSTIN (or dropping it for OTHER) invalidates any prior portal
      // auto-fill, so re-enable the address fields until the next successful Verify.
      setGstAutofilled(false);
      setGstVerifiedStatus(null);
      setGstVerifiedTaxpayer(null);
      setGstVerifiedAdditional(null);
      // Any pending captcha challenge is tied to the old GSTIN — discard it.
      setGstSession(null);
      setGstCaptchaValue("");
    }
    if (field === "drug_license_number") {
      // Editing the licence number invalidates any prior verification.
      setDrugVerifiedLogId(null);
      setDrugVerifiedExpiry(null);
      setDrugVerifiedHolder(null);
    }
    if (field === "drug_license_2_number") {
      // Editing the second licence number invalidates any prior verification.
      setDrugVerified2LogId(null);
      setDrugVerified2Expiry(null);
      setDrugVerified2Holder(null);
    }
    setFormErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function saveForm() {
    const nextErrors = validateForm(form);
    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      // Surface errors that live on a hidden tab by switching to it.
      if (nextErrors.credit_limit) {
        setFormTab("commercial");
      } else if (nextErrors.pincode) {
        setFormTab("contact");
      }
      setSummary("Fix the highlighted Party Master fields before saving.");
      return;
    }
    if (requiresGstVerification) {
      setFormErrors((current) => ({
        ...current,
        gstin: "GST verification is mandatory for non-retailer parties.",
      }));
      setSummary("Verify the GSTIN before saving — mandatory for non-retailers.");
      return;
    }

    setSaving(true);
    setError(null);
    setSummary(null);
    try {
      const payload = {
        ...toPartyPayload(form),
        gst_verification_log_id: verifiedLogId ?? undefined,
        drug_license_verification_log_id: drugVerifiedLogId ?? undefined,
        drug_license_2_verification_log_id: drugVerified2LogId ?? undefined,
      };
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
    const setVerifiedExpiry =
      slot === 2 ? setDrugVerified2Expiry : setDrugVerifiedExpiry;
    const setVerifiedHolder =
      slot === 2 ? setDrugVerified2Holder : setDrugVerifiedHolder;
    const setVerifiedLogIdForSlot =
      slot === 2 ? setDrugVerified2LogId : setDrugVerifiedLogId;

    if (!licenseNumber.trim()) {
      setVerifyError("Enter a drug licence number first.");
      return;
    }

    setVerifying(true);
    setVerifyError(null);

    try {
      // Verify standalone — like GSTIN verification, don't create the party
      // first, so a duplicate-GSTIN save error can't surface during drug-licence
      // verification. New-party results are persisted on Save via the log id.
      const session = await apiClient.startDrugLicenseVerification({
        party_id: editingPartyId ?? undefined,
        drug_license_number: licenseNumber.trim(),
      });
      if (session.log.status === "CAPTCHA_REQUIRED") {
        setVerifyError(
          "Captcha required — could not auto-verify. Use the Drug Licence Verification screen to complete verification manually.",
        );
        return;
      }
      if (!session.result) {
        setVerifyError(
          session.log.remarks ??
            "Verification failed. Check the Drug Licence Verification screen for details.",
        );
        return;
      }
      // Success: capture the verified expiry; persist now for an existing party,
      // otherwise remember the log so it's applied when the new party is saved.
      setVerifiedExpiry(session.result.valid_upto ?? null);
      setVerifiedHolder(session.result.holder_name ?? null);
      if (editingPartyId && session.can_save) {
        const updatedParty = await apiClient.saveDrugLicenseVerification(
          session.log.id,
          { slot },
        );
        setEditingParty(updatedParty);
        setItems((current) =>
          current.map((p) => (p.id === updatedParty.id ? updatedParty : p)),
        );
      } else {
        setVerifiedLogIdForSlot(session.log.id);
      }
      setSummary("Drug licence verified.");
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

    // Decide whether the portal address should overwrite what's already filled.
    // When editing a party that already has a different address, ask first
    // rather than silently replacing it.
    const parsedAddress = result.principal_address
      ? parseGstAddress(result.principal_address)
      : null;
    let applyAddress = true;
    if (parsedAddress) {
      const currentHasAddress = !!(
        form.address_line_1.trim() ||
        form.address_line_2.trim() ||
        form.city.trim() ||
        form.pincode.trim()
      );
      const addressDiffers =
        (parsedAddress.address_line_1 ?? "").trim() !== form.address_line_1.trim() ||
        (parsedAddress.address_line_2 ?? "").trim() !== form.address_line_2.trim() ||
        (parsedAddress.city ?? "").trim() !== form.city.trim() ||
        (parsedAddress.pincode ?? "").trim() !== form.pincode.trim();
      if (editingPartyId && currentHasAddress && addressDiffers) {
        applyAddress = window.confirm(
          "The GST-registered address is different from the address currently filled in.\n\n" +
            "Replace the current address with the GST address?\n\n" +
            "OK = replace · Cancel = keep current address",
        );
      }
    }

    setForm((current) => {
      const updates: Partial<PartyFormState> = {};
      // Verification is authoritative — populate the trade name (falling back to
      // the legal name) even if the user had typed something different.
      const name = result.trade_name || result.legal_name;
      if (name) updates.party_name = name;
      if (result.taxpayer_type) {
        updates.registration_type = mapGstTaxpayerType(result.taxpayer_type);
      }
      if (applyAddress && parsedAddress) {
        if (parsedAddress.address_line_1)
          updates.address_line_1 = parsedAddress.address_line_1;
        if (parsedAddress.address_line_2)
          updates.address_line_2 = parsedAddress.address_line_2;
        if (parsedAddress.city) updates.city = parsedAddress.city;
        if (parsedAddress.pincode) updates.pincode = parsedAddress.pincode;
      }
      return { ...current, ...updates };
    });
    // Portal data is now in the name/address fields — lock them against edits.
    setGstAutofilled(true);
    setVerifiedLogId(session.log.id);
    setGstVerifiedStatus(result.status ?? null);
    setGstVerifiedTaxpayer(result.taxpayer_type ?? null);
    setGstVerifiedAdditional(result.additional_addresses ?? null);
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
          defaultOpen
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
                      <span className="inline-flex shrink-0 items-center gap-1 text-[hsl(var(--primary))]">
                        <CheckCircle2
                          role="img"
                          aria-label="GSTIN verified"
                          className="h-5 w-5"
                        />
                        <span className="text-xs font-semibold">Verified</span>
                      </span>
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
            <FieldShell label="Email" error={formErrors.email}>
              <Input
                value={form.email}
                onChange={(event) => updateFormField("email", event.target.value)}
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

        <AppTabs
          tabs={[
            { id: "contact", label: "Contact & Address" },
            { id: "tax", label: "Tax & Compliance" },
            { id: "commercial", label: "Commercial Details" },
          ]}
          value={formTab}
          onChange={(value) => setFormTab(value as typeof formTab)}
        />

        {formTab === "contact" ? (
        <FormSection
          title="Contact & Address"
          collapsible={false}
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
                onChange={(event) =>
                  updateFormField("pincode", event.target.value)
                }
              />
            </FieldShell>
            <FieldShell label="Country">
              <Input
                value={form.country}
                disabled={gstFieldsLocked}
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
            <FieldShell label="WhatsApp No">
              <Input
                value={form.whatsapp_no}
                onChange={(event) =>
                  updateFormField("whatsapp_no", event.target.value)
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
          {additionalAddressesDisplay ? (
            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={() => setShowAdditionalAddresses((value) => !value)}
                className="text-sm font-medium text-[hsl(var(--primary))] underline-offset-4 hover:underline"
              >
                {showAdditionalAddresses ? "Hide" : "Show"} additional places of
                business
              </button>
              {showAdditionalAddresses ? (
                <textarea
                  readOnly
                  value={additionalAddressesDisplay}
                  rows={4}
                  className="w-full cursor-not-allowed rounded-xl border border-input bg-[hsl(var(--muted-bg))] px-3 py-2 text-sm text-[hsl(var(--text-secondary))] shadow-inner outline-none"
                />
              ) : null}
            </div>
          ) : null}
        </FormSection>
        ) : null}

        {formTab === "tax" ? (
        <FormSection title="Tax & Compliance" collapsible={false}>
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
            <FieldShell label="GST Status">
              <Input
                value={gstStatusDisplay}
                disabled
                placeholder="Auto-filled after verification"
              />
            </FieldShell>
            <FieldShell label="GST Taxpayer Type">
              <Input
                value={gstTaxpayerDisplay}
                disabled
                placeholder="Auto-filled after verification"
              />
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
                  !drugLicenseVerifyError &&
                  !verifyingDrugLicense && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[hsl(var(--primary))]">
                      <CheckCircle2
                        role="img"
                        aria-label="Drug licence verified"
                        className="h-5 w-5"
                      />
                      <span className="text-xs font-semibold">Verified</span>
                    </span>
                  )}
                {(drugLicenseVerifyError ||
                  editingParty?.drug_license_verified_status === "FAILED" ||
                  editingParty?.drug_license_verified_status === "EXPIRED") &&
                  !verifyingDrugLicense && (
                    <XCircle className="h-5 w-5 shrink-0 text-rose-500" />
                  )}
              </div>
            </FieldShell>
            <FieldShell label="Drug Licence Holder Name">
              <Input
                value={drugLicenseHolderDisplay}
                disabled
                placeholder="Auto-filled after verification"
              />
            </FieldShell>
            <FieldShell label="Drug Licence Expiry Date">
              <Input
                value={drugLicenseExpiryDisplay}
                disabled
                placeholder="Auto-filled after verification"
              />
            </FieldShell>
            {showSecondDrugLicense ? (
              <>
            <div className="col-span-1 flex items-center justify-between md:col-span-2 xl:col-span-3">
              <p className="text-sm font-semibold text-[hsl(var(--text-primary))]">
                Second Drug Licence
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowSecondDrugLicense(false);
                  updateFormField("drug_license_2_number", "");
                  setDrugLicense2VerifyError(null);
                }}
                className="text-rose-600 hover:text-rose-700"
              >
                Remove
              </Button>
            </div>
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
                  !drugLicense2VerifyError &&
                  !verifyingDrugLicense2 && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[hsl(var(--primary))]">
                      <CheckCircle2
                        role="img"
                        aria-label="Second drug licence verified"
                        className="h-5 w-5"
                      />
                      <span className="text-xs font-semibold">Verified</span>
                    </span>
                  )}
                {(drugLicense2VerifyError ||
                  editingParty?.drug_license_2_verified_status === "FAILED" ||
                  editingParty?.drug_license_2_verified_status ===
                    "EXPIRED") &&
                  !verifyingDrugLicense2 && (
                    <XCircle className="h-5 w-5 shrink-0 text-rose-500" />
                  )}
              </div>
            </FieldShell>
            <FieldShell label="Drug Licence 2 Holder Name">
              <Input
                value={drugLicense2HolderDisplay}
                disabled
                placeholder="Auto-filled after verification"
              />
            </FieldShell>
            <FieldShell label="Drug Licence 2 Expiry Date">
              <Input
                value={drugLicense2ExpiryDisplay}
                disabled
                placeholder="Auto-filled after verification"
              />
            </FieldShell>
              </>
            ) : (
              <FieldShell label="Second Drug Licence">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowSecondDrugLicense(true)}
                  className="w-full justify-center"
                >
                  + Add another drug licence
                </Button>
              </FieldShell>
            )}
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
        </FormSection>
        ) : null}

        {formTab === "commercial" ? (
        <FormSection title="Commercial Details" collapsible={false}>
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
        ) : null}

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
      {error ? (
        <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>
      ) : null}

      <AppTable
        title="All Parties"
        description="Search by name, code, GSTIN, contact or state, then click Edit to load a party into the form above."
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
                className="h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground"
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
          <TableHeader className="sticky top-0 bg-[hsl(var(--table-header-bg))]">
            <TableRow>
              <TableHead className="sticky left-0 z-10 bg-[hsl(var(--table-header-bg))]">
                Action
              </TableHead>
              <TableHead>Party</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>GSTIN</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Drug License No</TableHead>
              <TableHead>Drug Licence Holder</TableHead>
              <TableHead>Drug Licence Expiry</TableHead>
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
                  colSpan={14}
                  className="py-10 text-center text-sm text-[hsl(var(--text-secondary))]"
                >
                  Loading Party Master records...
                </TableCell>
              </TableRow>
            ) : filteredSavedParties.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={14}
                  className="py-10 text-center text-sm text-[hsl(var(--text-secondary))]"
                >
                  No parties match your search.
                </TableCell>
              </TableRow>
            ) : (
              paginatedSavedParties.map((party) => (
                <TableRow key={party.id} className="align-top">
                  <TableCell className="sticky left-0 z-[1] min-w-[92px] bg-[hsl(var(--card-bg))]">
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
                    {party.gstin ? (
                      <div className="space-y-1">
                        <p
                          className={cn(
                            party.gst_verified_status === "VERIFIED" &&
                              "font-medium text-[hsl(var(--primary))]",
                          )}
                        >
                          {party.gstin}
                        </p>
                        {party.gst_verified_status === "VERIFIED" ? (
                          <span className="text-xs text-[hsl(var(--text-secondary))]">
                            Last verified {formatDateTime(party.gst_verified_at)}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="min-w-[180px]">
                    {party.state ?? "-"}
                  </TableCell>
                  <TableCell className="min-w-[170px]">
                    <div className="space-y-2">
                      <p
                        className={cn(
                          party.drug_license_verified_status === "VERIFIED" &&
                            "font-medium text-[hsl(var(--primary))]",
                        )}
                      >
                        {party.drug_license_number ?? "-"}
                      </p>
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
                  <TableCell className="min-w-[200px]">
                    {party.drug_license_holder_name ?? "-"}
                  </TableCell>
                  <TableCell className="min-w-[150px]">
                    {party.drug_license_valid_upto
                      ? new Intl.DateTimeFormat("en-IN", {
                          dateStyle: "medium",
                        }).format(new Date(party.drug_license_valid_upto))
                      : "-"}
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
