"use client";

import {
  ExternalLink,
  History,
  RefreshCw,
  Save,
  SearchCheck,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

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
  type DrugLicenseVerificationLog,
  type DrugLicenseVerificationSession,
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
    case "EXPIRED":
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
// Result card — fresh session result OR stored party data
// ---------------------------------------------------------------------------

type ResultCardProps = {
  session: DrugLicenseVerificationSession | null;
  party: Party | null;
  canSave: boolean;
  submitting: boolean;
  onSave: (remarks: string) => Promise<void>;
};

function ResultCard({ session, party, canSave, submitting, onSave }: ResultCardProps) {
  const [remarks, setRemarks] = useState("");

  const freshResult = session?.result ?? null;
  const freshStatus = session?.log.status ?? null;

  // Prefer fresh session result; fall back to data stored on the party
  const licenceNumber = freshResult?.license_number ?? party?.drug_license_number ?? null;
  const holderName = freshResult?.holder_name ?? party?.drug_license_holder_name ?? null;
  const validUpto = freshResult?.valid_upto ?? party?.drug_license_valid_upto ?? null;
  const authority = freshResult?.authority ?? null;
  const state = freshResult?.state ?? party?.drug_license_state ?? null;
  const verifiedAt =
    freshStatus === "SUCCESS"
      ? (session?.log.requested_at ?? null)
      : (party?.drug_license_verified_at ?? null);
  const sourceUrl =
    session?.log.source_url ?? party?.drug_license_verification_source ?? null;
  const displayStatus =
    freshStatus === "SUCCESS"
      ? "VERIFIED"
      : party?.drug_license_verified_status !== "NOT_VERIFIED"
        ? (party?.drug_license_verified_status ?? null)
        : null;

  const hasData = !!(licenceNumber || holderName);
  const canSaveNow = session?.can_save && canSave;

  // Show placeholder only when no session and no party selected
  if (!session && !party) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-[hsl(var(--muted-bg))] p-8 text-center">
        <ShieldX className="h-8 w-8 text-[hsl(var(--text-secondary))] opacity-40" />
        <p className="text-sm font-medium text-[hsl(var(--text-secondary))]">
          Enter a licence number and click Verify.
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
          Click <strong>Verify</strong> to run an automated check against the SFDA portal.
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
            {holderName ?? licenceNumber}
          </p>
          <p className="text-sm text-[hsl(var(--text-secondary))]">
            Licence:{" "}
            <span className="font-mono font-medium tracking-wide">{licenceNumber}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {displayStatus && <StatusBadge status={displayStatus} />}
          {verifiedAt && (
            <p className="text-xs text-[hsl(var(--text-secondary))]">{fmtDateTime(verifiedAt)}</p>
          )}
        </div>
      </div>

      {/* Fields grid */}
      <div className="grid gap-x-8 gap-y-5 px-6 py-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Licence Number"
          value={<span className="font-mono">{licenceNumber}</span>}
        />
        <Field label="Holder / Firm" value={holderName} />
        <Field label="Valid Upto" value={fmtDate(validUpto)} />
        <Field
          label="Authority / State"
          value={[authority, state].filter(Boolean).join(" / ") || null}
        />
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
            View on SFDA Portal
          </a>
        </div>
      )}

      {/* Save — only when a fresh successful result is available and a party is linked */}
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

      {/* Portal Verification Data — always shown when result available */}
      <div className="border-t border-border px-6 py-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-[hsl(var(--text-primary))]">Portal Verification Data</p>
          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            Raw snapshot from SFDA portal
          </span>
        </div>
        {freshResult?.raw_snapshot ? (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-input bg-[hsl(var(--muted-bg))] px-3 py-3 text-xs text-[hsl(var(--text-secondary))]">
            {JSON.stringify(freshResult.raw_snapshot, null, 2)}
          </pre>
        ) : party?.drug_license_raw_snapshot ? (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-input bg-[hsl(var(--muted-bg))] px-3 py-3 text-xs text-[hsl(var(--text-secondary))]">
            {JSON.stringify(party.drug_license_raw_snapshot, null, 2)}
          </pre>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-400 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500">
            No portal snapshot available yet.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Captcha fallback — only when auto-solve fails
// ---------------------------------------------------------------------------

type CaptchaFallbackProps = {
  session: DrugLicenseVerificationSession;
  submitting: boolean;
  onResume: (captchaValue: string) => Promise<void>;
};

function CaptchaFallback({ session, submitting, onResume }: CaptchaFallbackProps) {
  const [captchaValue, setCaptchaValue] = useState("");

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="mb-1 text-sm font-semibold text-amber-800 dark:text-amber-300">
        Manual captcha required
      </p>
      <p className="mb-4 text-xs text-amber-700 dark:text-amber-400">
        {session.challenge_text ??
          "Auto-solving failed. Open the portal, complete the captcha, then enter the value below."}
      </p>
      {session.log.source_url && (
        <a
          href={session.log.source_url}
          target="_blank"
          rel="noreferrer"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 underline-offset-4 hover:underline dark:text-amber-300"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open SFDA Portal
        </a>
      )}
      <div className="flex gap-2">
        <Input
          value={captchaValue}
          onChange={(e) => setCaptchaValue(e.target.value.toUpperCase())}
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

export function DrugLicenseVerificationWorkspace() {
  const searchParams = useSearchParams();
  const requestedPartyId = searchParams.get("partyId");
  const { user, hasPermission, loading: permissionsLoading } = usePermissions();
  const canVerify = !!user && (user.is_superuser || hasPermission("drug_license:verify"));
  const canSave = !!user && (user.is_superuser || hasPermission("drug_license:save_verified_data"));
  const canViewHistory =
    !!user && (user.is_superuser || hasPermission("drug_license:history_view"));

  const [parties, setParties] = useState<Party[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [session, setSession] = useState<DrugLicenseVerificationSession | null>(null);
  const [history, setHistory] = useState<DrugLicenseVerificationLog[]>([]);
  const [historyPartyFilter, setHistoryPartyFilter] = useState("");
  const [selectedHistoryDetail, setSelectedHistoryDetail] =
    useState<DrugLicenseVerificationLog | null>(null);

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
      const resp = await apiClient.listDrugLicenseVerificationHistory();
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
            setLicenseNumber(match.drug_license_number ?? "");
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
    // loadHistory is intentionally omitted — it's stable and only depends on canViewHistory
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionsLoading, canViewHistory]);

  function handlePartyChange(value: string) {
    setSelectedPartyId(value);
    const party = parties.find((p) => String(p.id) === value) ?? null;
    setLicenseNumber(party?.drug_license_number ?? "");
    setSession(null);
    setError(null);
    setSuccessMsg(null);
    setSelectedHistoryDetail(null);
    setHistoryPartyFilter(value);
  }

  async function handleVerify() {
    if (!licenseNumber.trim()) {
      setError("Enter a drug licence number before verifying.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);
    setSession(null);
    try {
      const next = await apiClient.startDrugLicenseVerification({
        party_id: selectedPartyId ? Number(selectedPartyId) : undefined,
        drug_license_number: licenseNumber.trim(),
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
      const next = await apiClient.resumeDrugLicenseVerification(session.log.id, {
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
      const updatedParty = await apiClient.saveDrugLicenseVerification(session.log.id, {
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
      const detail = await apiClient.getDrugLicenseVerificationHistoryDetail(logId);
      setSelectedHistoryDetail(detail);
    } catch {
      // ignore
    }
  }

  const needsCaptcha = session?.log.status === "CAPTCHA_REQUIRED";

  return (
    <div className="space-y-6">
      {/* ── Input strip ─────────────────────────────────────────── */}
      <AppSectionCard
        title="Drug Licence Verification"
        description="Enter a drug licence number and click Verify — the portal captcha is solved automatically. Optionally link a party to save results to Party Master."
      >
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="space-y-2">
            <label className="text-sm font-medium text-[hsl(var(--text-primary))]">Party <span className="font-normal text-[hsl(var(--text-secondary))]">(optional)</span></label>
            <select
              value={selectedPartyId}
              onChange={(e) => handlePartyChange(e.target.value)}
              disabled={loading}
              data-testid="drug-license-party-selector"
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
            <label className="text-sm font-medium text-[hsl(var(--text-primary))]">
              Drug Licence Number
            </label>
            <Input
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value.toUpperCase())}
              placeholder="Enter or confirm licence number"
              disabled={loading}
              data-testid="drug-license-number-input"
            />
          </div>

          <Button
            type="button"
            onClick={() => void handleVerify()}
            disabled={!canVerify || submitting || loading || !licenseNumber.trim()}
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

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        {successMsg && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="h-4 w-4" />
            {successMsg}
          </p>
        )}
      </AppSectionCard>

      {/* ── Captcha fallback (only when auto-solve fails) ───────── */}
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
          description="Full audit trail of all verification attempts."
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
                  <TableHead>Licence Number</TableHead>
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
                      <TableCell className="font-mono text-xs">
                        {item.drug_license_number}
                      </TableCell>
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

      {/* ── History detail ───────────────────────────────────────── */}
      {selectedHistoryDetail && (
        <AppSectionCard
          title={`Verification Detail #${selectedHistoryDetail.id}`}
          description="Stored payload for this verification attempt."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 rounded-2xl border border-border bg-[hsl(var(--muted-bg))] p-4 text-sm">
              <p>
                <span className="font-medium">Party:</span>{" "}
                {selectedHistoryDetail.party_name ?? "-"}
              </p>
              <p>
                <span className="font-medium">Licence:</span>{" "}
                <span className="font-mono">{selectedHistoryDetail.drug_license_number}</span>
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
        </AppSectionCard>
      )}
    </div>
  );
}
