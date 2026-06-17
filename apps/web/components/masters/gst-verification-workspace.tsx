"use client";

import {
  ExternalLink,
  History,
  RefreshCw,
  Save,
  SearchCheck,
  ShieldCheck,
  ShieldX,
  X,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  Transition,
  TransitionChild,
} from "@headlessui/react";

import { usePermissions } from "@/components/auth/permission-provider";
import { AppSectionCard, AppTable } from "@/components/erp/app-primitives";
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
  type GSTVerificationLog,
  type GSTVerificationSession,
  type Party,
} from "@/lib/api/client";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDateTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function fmtDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value));
}

function hasSnapshotData(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function formatSnapshot(value: unknown): string | null {
  if (!hasSnapshotData(value)) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return trimmed;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function statusChipClass(status: string) {
  switch (status) {
    case "VERIFIED":
    case "SUCCESS":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300";
    case "CAPTCHA_REQUIRED":
    case "PENDING_REVIEW":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300";
    case "FAILED":
    case "PARSE_FAILED":
    case "INACTIVE":
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300";
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide",
        statusChipClass(status),
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
        {label}
      </p>
      <p className="text-sm font-medium text-[hsl(var(--text-primary))]">{value || "-"}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result card
// ---------------------------------------------------------------------------

type ResultCardProps = {
  session: GSTVerificationSession | null;
  party: Party | null;
  canSave: boolean;
  submitting: boolean;
  onSave: (remarks: string) => Promise<void>;
};

function ResultCard({ session, party, canSave, submitting, onSave }: ResultCardProps) {
  const [remarks, setRemarks] = useState("");

  const freshResult = session?.result ?? null;
  const freshStatus = session?.log.status ?? null;

  const gstin = freshResult?.gstin ?? party?.gstin ?? session?.log.gstin ?? null;
  const legalName = freshResult?.legal_name ?? party?.gst_legal_name ?? null;
  const tradeName = freshResult?.trade_name ?? party?.gst_trade_name ?? null;
  const gstStatus = freshResult?.status ?? null;
  const regDate = freshResult?.registration_date ?? party?.gst_registration_date ?? null;
  const constitution = freshResult?.constitution ?? null;
  const stateJurisdiction = freshResult?.state_jurisdiction ?? null;
  const principalAddress = freshResult?.principal_address ?? null;
  const natureOfBusiness = freshResult?.nature_of_business ?? null;
  const einvoiceStatus = freshResult?.einvoice_status ?? null;
  const sourceUrl = session?.log.source_url ?? party?.gst_verification_source ?? null;
  const verifiedAt =
    freshStatus === "SUCCESS"
      ? (session?.log.requested_at ?? null)
      : (party?.gst_verified_at ?? null);
  const displayStatus =
    freshStatus
      ? (freshStatus === "SUCCESS" ? "VERIFIED" : freshStatus)
      : party?.gst_verified_status !== "NOT_VERIFIED"
        ? (party?.gst_verified_status ?? null)
        : null;
  const structuredSnapshotText =
    formatSnapshot(freshResult?.raw_snapshot) ?? formatSnapshot(party?.gst_raw_snapshot);
  const responseSnapshotText = formatSnapshot(session?.log.response_snapshot);

  const hasData = !!(gstin || legalName || structuredSnapshotText || responseSnapshotText);
  const canSaveNow = session?.can_save && canSave;

  if (!session && !party) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-[hsl(var(--muted-bg))] p-8 text-center">
        <ShieldX className="h-8 w-8 text-[hsl(var(--text-secondary))] opacity-40" />
        <p className="text-sm font-medium text-[hsl(var(--text-secondary))]">
          Enter a GSTIN and click Verify.
        </p>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-[hsl(var(--muted-bg))] p-8 text-center">
        <ShieldX className="h-8 w-8 text-[hsl(var(--text-secondary))] opacity-40" />
        <p className="text-sm font-medium text-[hsl(var(--text-secondary))]">
          No verification data yet.
        </p>
        <p className="text-xs text-[hsl(var(--text-secondary))] opacity-70">
          Click <strong>Verify</strong> to run an automated check against the GST portal.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div className="space-y-0.5">
          <p className="text-base font-semibold text-[hsl(var(--text-primary))]">
            {legalName ?? tradeName ?? gstin}
          </p>
          <p className="text-sm text-[hsl(var(--text-secondary))]">
            GSTIN:{" "}
            <span className="font-mono font-medium tracking-wide">{gstin}</span>
          </p>
          {tradeName && legalName && tradeName !== legalName && (
            <p className="text-xs text-[hsl(var(--text-secondary))]">
              Trade Name: {tradeName}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {displayStatus && <StatusBadge status={displayStatus} />}
          {gstStatus && gstStatus !== displayStatus && (
            <span className="text-xs text-[hsl(var(--text-secondary))]">
              Portal status: {gstStatus}
            </span>
          )}
          {verifiedAt && (
            <p className="text-xs text-[hsl(var(--text-secondary))]">{fmtDateTime(verifiedAt)}</p>
          )}
        </div>
      </div>

      {/* Fields grid */}
      <div className="grid gap-x-8 gap-y-5 px-6 py-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="GSTIN" value={<span className="font-mono">{gstin}</span>} />
        <Field label="Legal Name" value={legalName} />
        <Field label="Trade Name" value={tradeName} />
        <Field label="Constitution" value={constitution} />
        <Field label="Registration Date" value={fmtDate(regDate)} />
        <Field label="E-Invoice Status" value={einvoiceStatus} />
        {stateJurisdiction && (
          <Field label="State Jurisdiction" value={stateJurisdiction} />
        )}
        {principalAddress && (
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Principal Place of Business" value={principalAddress} />
          </div>
        )}
        {natureOfBusiness && natureOfBusiness.length > 0 && (
          <div className="sm:col-span-2 lg:col-span-3">
            <Field
              label="Nature of Business"
              value={natureOfBusiness.join(", ")}
            />
          </div>
        )}
      </div>

      {/* Source link */}
      {sourceUrl && (
        <div className="border-t border-border px-6 py-3">
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary underline-offset-4 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View on GST Portal
          </a>
        </div>
      )}

      {/* Save to Party Master */}
      {canSaveNow && (
        <div className="space-y-3 border-t border-border px-6 py-4">
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={2}
            placeholder="Optional review note before saving to Party Master…"
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
          />
          <div className="flex justify-end">
            <Button type="button" onClick={() => void onSave(remarks)} disabled={submitting}>
              <Save className="mr-2 h-4 w-4" />
              Save to Party Master
            </Button>
          </div>
        </div>
      )}

      {/* Portal Verification Data — always shown */}
      <div className="border-t border-border px-6 py-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-[hsl(var(--text-primary))]">Portal Verification Data</p>
          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            Raw snapshot from GST portal
          </span>
        </div>
        {structuredSnapshotText ? (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-input bg-[hsl(var(--muted-bg))] px-3 py-3 text-xs text-[hsl(var(--text-secondary))]">
            {structuredSnapshotText}
          </pre>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-400 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500">
            No structured GST payload was parsed from the portal response.
          </p>
        )}

        {responseSnapshotText && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
              Full Portal Response
            </p>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-input bg-[hsl(var(--muted-bg))] px-3 py-3 text-xs text-[hsl(var(--text-secondary))]">
              {responseSnapshotText}
            </pre>
          </div>
        )}

        {!structuredSnapshotText && !responseSnapshotText && (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-input bg-[hsl(var(--muted-bg))] px-3 py-3 text-xs text-[hsl(var(--text-secondary))]">
            No portal snapshot available yet.
          </pre>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Captcha fallback
// ---------------------------------------------------------------------------

type CaptchaFallbackProps = {
  session: GSTVerificationSession;
  submitting: boolean;
  onResume: (captchaValue: string) => Promise<void>;
};

function CaptchaFallback({ session, submitting, onResume }: CaptchaFallbackProps) {
  const [captchaValue, setCaptchaValue] = useState("");

  const sessionCtx = session.log.extracted_data_json as Record<string, unknown> | null;
  const captchaImageB64 =
    typeof sessionCtx?.session_context === "object" && sessionCtx.session_context !== null
      ? (sessionCtx.session_context as Record<string, unknown>).captcha_image_b64 as
          | string
          | undefined
      : undefined;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="mb-1 text-sm font-semibold text-amber-800 dark:text-amber-300">
        Manual captcha required
      </p>
      <p className="mb-4 text-xs text-amber-700 dark:text-amber-400">
        {session.challenge_text ??
          "Auto-solving failed. Open the GST portal, complete the captcha, then enter the value below."}
      </p>

      {captchaImageB64 ? (
        <div className="mb-4">
          <p className="mb-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
            Enter the characters shown:
          </p>
          <img
            src={`data:image/png;base64,${captchaImageB64}`}
            alt="GST portal captcha"
            className="rounded border border-amber-300 bg-white p-1 dark:border-amber-500/50"
          />
        </div>
      ) : (
        session.log.source_url && (
          <a
            href={session.log.source_url}
            target="_blank"
            rel="noreferrer"
            className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 underline-offset-4 hover:underline dark:text-amber-300"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open GST Portal
          </a>
        )
      )}

      <div className="flex gap-2">
        <Input
          value={captchaValue}
          onChange={(e) => setCaptchaValue(e.target.value)}
          placeholder="Enter captcha value"
          className="max-w-xs"
        />
        <Button
          type="button"
          onClick={() => void onResume(captchaValue)}
          disabled={!captchaValue.trim() || submitting}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main workspace
// ---------------------------------------------------------------------------

export function GSTVerificationWorkspace() {
  const searchParams = useSearchParams();
  const requestedPartyId = searchParams.get("partyId");
  const { user, hasPermission, loading: permissionsLoading } = usePermissions();
  const canVerify = !!user && (user.is_superuser || hasPermission("gst:verify"));
  const canSave = !!user && (user.is_superuser || hasPermission("gst:save_verified_data"));
  const canViewHistory = !!user && (user.is_superuser || hasPermission("gst:history_view"));

  const [parties, setParties] = useState<Party[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState("");
  const [gstin, setGstin] = useState("");
  const [session, setSession] = useState<GSTVerificationSession | null>(null);
  const [history, setHistory] = useState<GSTVerificationLog[]>([]);
  const [historyPartyFilter, setHistoryPartyFilter] = useState("");
  const [selectedHistoryDetail, setSelectedHistoryDetail] =
    useState<GSTVerificationLog | null>(null);

  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const selectedParty = useMemo(
    () => parties.find((p) => String(p.id) === selectedPartyId) ?? null,
    [parties, selectedPartyId],
  );

  const partyOptions = useMemo(
    () => parties.map((p) => ({ value: String(p.id), label: p.party_name ?? p.name })),
    [parties],
  );

  const filteredHistory = useMemo(
    () =>
      historyPartyFilter
        ? history.filter((item) => String(item.party_id) === historyPartyFilter)
        : history,
    [history, historyPartyFilter],
  );

  async function loadParties() {
    const items = await apiClient.listParties();
    setParties(items);
    return items;
  }

  async function loadHistory() {
    if (!canViewHistory) return;
    setHistoryLoading(true);
    try {
      const resp = await apiClient.listGSTVerificationHistory();
      setHistory(resp.items);
    } catch {
      // history is non-critical
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setLoading(true);
      try {
        const items = await loadParties();
        if (!cancelled && requestedPartyId) {
          const match = items.find((p) => String(p.id) === requestedPartyId);
          if (match) {
            setSelectedPartyId(requestedPartyId);
            setGstin(match.gstin ?? "");
            setHistoryPartyFilter(requestedPartyId);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [requestedPartyId]);

  useEffect(() => {
    if (!permissionsLoading && canViewHistory) void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionsLoading, canViewHistory]);

  function handlePartyChange(value: string) {
    setSelectedPartyId(value);
    const party = parties.find((p) => String(p.id) === value) ?? null;
    setGstin(party?.gstin ?? "");
    setSession(null);
    setError(null);
    setSuccessMsg(null);
    setSelectedHistoryDetail(null);
    setHistoryPartyFilter(value);
  }

  async function handleVerify() {
    if (!gstin.trim()) {
      setError("Enter a GSTIN before verifying.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    setSession(null);
    try {
      const next = await apiClient.startGSTVerification({
        party_id: selectedPartyId ? Number(selectedPartyId) : undefined,
        gstin: gstin.trim().toUpperCase(),
      });
      setSession(next);
      if (next.log.status === "SUCCESS") {
        setSuccessMsg("Verification successful. Review the result and save to Party Master.");
        await loadParties();
      }
      if (canViewHistory) await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResume(captchaValue: string) {
    if (!session) return;
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const next = await apiClient.resumeGSTVerification(session.log.id, {
        captcha_value: captchaValue,
      });
      setSession(next);
      if (next.log.status === "SUCCESS") {
        setSuccessMsg("Verification successful. Review the result and save to Party Master.");
        await loadParties();
      }
      if (canViewHistory) await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to continue verification.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSave(remarks: string) {
    if (!session) return;
    setSubmitting(true);
    setError(null);
    try {
      const updatedParty = await apiClient.saveGSTVerification(session.log.id, {
        remarks: remarks || undefined,
      });
      setSuccessMsg(`Verified data saved to ${updatedParty.party_name ?? updatedParty.name}.`);
      setSession((prev) => (prev ? { ...prev, can_save: false } : prev));
      await loadParties();
      if (canViewHistory) await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleViewDetail(logId: number) {
    try {
      const detail = await apiClient.getGSTVerificationHistoryDetail(logId);
      setSelectedHistoryDetail(detail);
    } catch {
      // ignore
    }
  }

  const needsCaptcha = session?.log.status === "CAPTCHA_REQUIRED";
  const verifyDisabled =
    permissionsLoading || !canVerify || submitting || loading || !gstin.trim();

  return (
    <div className="space-y-6">
      {/* ── Input strip ─────────────────────────────────────────── */}
      <AppSectionCard
        title="GST Taxpayer Verification"
        description="Enter a GSTIN and click Verify — the portal captcha is solved automatically. Optionally link a party to save results to Party Master."
      >
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="space-y-2">
            <label className="text-sm font-medium text-[hsl(var(--text-primary))]">
              Party{" "}
              <span className="font-normal text-[hsl(var(--text-secondary))]">(optional)</span>
            </label>
            <select
              value={selectedPartyId}
              onChange={(e) => handlePartyChange(e.target.value)}
              disabled={loading}
              data-testid="gst-party-selector"
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">Select a party</option>
              {partyOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-[hsl(var(--text-primary))]">GSTIN</label>
            <Input
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              placeholder="Enter 15-character GSTIN"
              maxLength={15}
              disabled={loading}
              data-testid="gst-input"
            />
          </div>

          <Button
            type="button"
            onClick={() => void handleVerify()}
            disabled={verifyDisabled}
            className="h-11 self-end"
          >
            {submitting ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <SearchCheck className="mr-2 h-4 w-4" />
            )}
            {submitting ? "Verifying…" : session ? "Re-verify" : "Verify"}
          </Button>
        </div>

        {!permissionsLoading && !canVerify && (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
            You do not have permission to verify GST details. Contact your administrator for
            <span className="ml-1 font-mono">gst:verify</span> access.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        {successMsg && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="h-4 w-4" />
            {successMsg}
          </p>
        )}
      </AppSectionCard>

      {/* ── Captcha fallback ────────────────────────────────────── */}
      {needsCaptcha && (
        <CaptchaFallback session={session!} submitting={submitting} onResume={handleResume} />
      )}

      {/* ── Result card ──────────────────────────────────────────── */}
      <ResultCard
        session={session}
        party={selectedParty}
        canSave={canSave}
        submitting={submitting}
        onSave={handleSave}
      />

      {/* ── History ──────────────────────────────────────────────── */}
      {canViewHistory && (
        <AppTable
          title="Verification History"
          description="Full audit trail of all GST verification attempts."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={historyPartyFilter}
                onChange={(e) => setHistoryPartyFilter(e.target.value)}
                className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="">All parties</option>
                {partyOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadHistory()}
                disabled={historyLoading}
              >
                <History className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>
          }
        >
          {historyLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader className="bg-[hsl(var(--table-header-bg))]">
                <TableRow>
                  <TableHead>Verified At</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Verified By</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredHistory.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      No verification history found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredHistory.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{fmtDateTime(item.requested_at)}</TableCell>
                      <TableCell>{item.party_name ?? "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{item.gstin}</TableCell>
                      <TableCell>
                        <StatusBadge status={item.status} />
                      </TableCell>
                      <TableCell>{item.requested_by_name ?? "-"}</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleViewDetail(item.id)}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </AppTable>
      )}

      {/* ── History detail (modal) ───────────────────────────────── */}
      {selectedHistoryDetail && (
        <Transition appear show as={Fragment}>
          <Dialog
            as="div"
            className="relative z-50"
            onClose={() => setSelectedHistoryDetail(null)}
          >
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <DialogBackdrop className="fixed inset-0 bg-slate-950/35 backdrop-blur-sm" />
            </TransitionChild>

            <div className="fixed inset-0 flex items-center justify-center p-4">
              <TransitionChild
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="translate-y-2 opacity-0"
                enterTo="translate-y-0 opacity-100"
                leave="ease-in duration-150"
                leaveFrom="translate-y-0 opacity-100"
                leaveTo="translate-y-2 opacity-0"
              >
                <DialogPanel className="relative max-h-[85vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-[28px] border border-border bg-card p-6 shadow-2xl">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-0.5">
                      <p className="text-base font-semibold text-[hsl(var(--text-primary))]">
                        Verification Detail #{selectedHistoryDetail.id}
                      </p>
                      <p className="text-sm text-[hsl(var(--text-secondary))]">
                        Stored payload for this verification attempt.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedHistoryDetail(null)}
                      aria-label="Close"
                      className="rounded-full p-1 text-[hsl(var(--text-secondary))] transition hover:bg-[hsl(var(--muted-bg))] hover:text-[hsl(var(--text-primary))]"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 rounded-2xl border border-border bg-[hsl(var(--muted-bg))] p-4 text-sm">
              <p>
                <span className="font-medium">Party:</span>{" "}
                {selectedHistoryDetail.party_name ?? "-"}
              </p>
              <p>
                <span className="font-medium">GSTIN:</span>{" "}
                <span className="font-mono">{selectedHistoryDetail.gstin}</span>
              </p>
              <p className="flex items-center gap-2">
                <span className="font-medium">Status:</span>
                <StatusBadge status={selectedHistoryDetail.status} />
              </p>
              <p>
                <span className="font-medium">Verified By:</span>{" "}
                {selectedHistoryDetail.requested_by_name ?? "-"}
              </p>
            </div>
            <div className="space-y-2 rounded-2xl border border-border bg-[hsl(var(--muted-bg))] p-4 text-sm">
              <p>
                <span className="font-medium">Requested At:</span>{" "}
                {fmtDateTime(selectedHistoryDetail.requested_at)}
              </p>
              <p>
                <span className="font-medium">Remarks:</span>{" "}
                {selectedHistoryDetail.remarks ?? "-"}
              </p>
              {selectedHistoryDetail.source_url && (
                <a
                  href={selectedHistoryDetail.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Source Portal
                </a>
              )}
            </div>
          </div>
          {selectedHistoryDetail.extracted_data_json && (
            <details className="rounded-2xl border border-border bg-[hsl(var(--muted-bg))] p-4">
              <summary className="cursor-pointer text-sm font-medium text-[hsl(var(--text-primary))]">
                View extracted data
              </summary>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-[hsl(var(--text-secondary))]">
                {JSON.stringify(selectedHistoryDetail.extracted_data_json, null, 2)}
              </pre>
            </details>
          )}
          {formatSnapshot(selectedHistoryDetail.response_snapshot) && (
            <details className="rounded-2xl border border-border bg-[hsl(var(--muted-bg))] p-4">
              <summary className="cursor-pointer text-sm font-medium text-[hsl(var(--text-primary))]">
                View full portal response
              </summary>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-[hsl(var(--text-secondary))]">
                {formatSnapshot(selectedHistoryDetail.response_snapshot)}
              </pre>
            </details>
          )}
                </DialogPanel>
              </TransitionChild>
            </div>
          </Dialog>
        </Transition>
      )}
    </div>
  );
}
