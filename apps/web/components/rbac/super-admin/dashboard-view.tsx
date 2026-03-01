"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, KeyRound, LifeBuoy, ShieldCheck, ShieldUser, Users } from "lucide-react";

import { useRbacSession } from "@/components/rbac/session-provider";
import { CreateOrganizationModal } from "@/components/rbac/super-admin/create-organization-modal";
import { MetricCard } from "@/components/rbac/super-admin/metric-card";
import { OrganizationsTable } from "@/components/rbac/super-admin/organizations-table";
import { SudoConfirmModal } from "@/components/rbac/super-admin/sudo-confirm-modal";
import { useSuperAdminOrganizations } from "@/components/rbac/super-admin/use-super-admin-organizations";
import { rbacClient, type RbacSessionSnapshot } from "@/lib/rbac/client";
import { buildAuditLogs, buildOrganizationDashboardRecords, buildSummaryMetrics, type OrganizationDashboardRecord } from "@/lib/rbac/super-admin";

const metricIcons = [Building2, Users, ShieldCheck, ShieldUser, LifeBuoy, KeyRound];

export function SuperAdminDashboardView() {
  const { session, setSession } = useRbacSession();
  const router = useRouter();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<OrganizationDashboardRecord | null>(null);
  const [sudoTarget, setSudoTarget] = useState<OrganizationDashboardRecord | null>(null);
  const [sudoBusy, setSudoBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const { organizations, loading, error, reload } = useSuperAdminOrganizations();

  const dashboardRecords = useMemo(() => buildOrganizationDashboardRecords(organizations), [organizations]);
  const summaryMetrics = useMemo(() => buildSummaryMetrics(dashboardRecords), [dashboardRecords]);
  const auditPreview = useMemo(() => buildAuditLogs(dashboardRecords).slice(0, 4), [dashboardRecords]);

  const quickPanelTitle = selectedOrg ? selectedOrg.name : "Operational focus";
  const quickPanelDescription = selectedOrg
    ? `${selectedOrg.currentUsers} users provisioned in ${selectedOrg.schemaName}. ${selectedOrg.statusLabel} indicates current capacity pressure.`
    : "Provision tenants, adjust user limits, and review audit-sensitive events without leaving the control surface.";

  return (
    <>
      <div className="space-y-8">
        {statusMessage ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
            {statusMessage}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loading
            ? Array.from({ length: 6 }).map((_, index) => (
                <MetricCard key={`loading-${index}`} icon={metricIcons[index] ?? Building2} loading label="" />
              ))
            : summaryMetrics.map((metric, index) => (
                <MetricCard
                  key={metric.label}
                  icon={metricIcons[index] ?? Building2}
                  label={metric.label}
                  value={metric.value}
                  subtext={metric.subtext}
                  trend={metric.trend}
                  sparkline={metric.sparkline}
                />
              ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.7fr_0.75fr]">
          <OrganizationsTable
            organizations={dashboardRecords}
            nestedSudo={Boolean(session?.sudoBanner)}
            onViewDetails={(organization) => setSelectedOrg(organization)}
            onEditMaxUsers={async (organization) => {
              if (!session) {
                return;
              }
              const nextValue = window.prompt("Enter a new max user limit", String(organization.maxUsers));
              if (!nextValue) {
                return;
              }
              const parsed = Number(nextValue);
              if (!Number.isFinite(parsed) || parsed < 1) {
                setStatusMessage("Max users must be at least 1.");
                return;
              }
              await rbacClient.updateMaxUsers(session.token, organization.id, parsed);
              setStatusMessage(`Updated ${organization.name} limit to ${parsed}.`);
              await reload();
            }}
            onSudo={(organization) => {
              if (session?.sudoBanner) {
                setStatusMessage("Nested sudo is blocked. Exit the current sudo session first.");
                return;
              }
              setSudoTarget(organization);
            }}
            onViewAuditLogs={() => router.push("/rbac/super-admin/audit-logs")}
            onDelete={async (organization) => {
              if (!session) {
                return;
              }
              const confirmed = window.confirm(
                `Delete ${organization.name}? The schema will be archived as del_${organization.id}.`,
              );
              if (!confirmed) {
                return;
              }

              await rbacClient.deleteOrganization(session.token, organization.id);
              setSelectedOrg((current) => (current?.id === organization.id ? null : current));
              setStatusMessage(
                `Organization ${organization.name} was deleted and schema renamed to del_${organization.id}.`,
              );
              await reload();
            }}
          />

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Quick actions</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">{quickPanelTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{quickPanelDescription}</p>

              <div className="mt-6 grid gap-3">
                <button
                  className="rounded-2xl bg-slate-900 px-4 py-3 text-left text-sm font-medium text-white transition duration-200 hover:scale-[1.01] hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
                  onClick={() => setIsCreateOpen(true)}
                >
                  Create organization
                </button>
                <button
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-left text-sm font-medium text-slate-700 transition duration-200 hover:scale-[1.01] hover:border-slate-300 hover:text-slate-950 dark:border-slate-800 dark:text-slate-300 dark:hover:text-white"
                  onClick={() => router.push("/rbac/super-admin/reports")}
                >
                  Open reports
                </button>
                <button
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-left text-sm font-medium text-slate-700 transition duration-200 hover:scale-[1.01] hover:border-slate-300 hover:text-slate-950 dark:border-slate-800 dark:text-slate-300 dark:hover:text-white"
                  onClick={() => router.push("/rbac/super-admin/audit-logs")}
                >
                  Review audit logs
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Recent activity</p>
                  <h2 className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-50">Audit preview</h2>
                </div>
                <button
                  className="text-sm font-medium text-slate-600 transition hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"
                  onClick={() => router.push("/rbac/super-admin/audit-logs")}
                >
                  View all
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {auditPreview.map((entry) => (
                  <button
                    key={entry.id}
                    className="block w-full rounded-2xl border border-slate-200/80 px-4 py-3 text-left transition duration-200 hover:scale-[1.01] hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700"
                    onClick={() => router.push("/rbac/super-admin/audit-logs")}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-950 dark:text-slate-50">{entry.action}</p>
                      <span className="text-xs text-slate-400">{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(entry.timestamp))}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{entry.performedBy} • {entry.targetOrg}</p>
                  </button>
                ))}
                {!loading && auditPreview.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No audit records available yet.</p>
                ) : null}
              </div>
            </section>
          </div>
        </section>
      </div>

      <CreateOrganizationModal
        open={isCreateOpen}
        busy={isCreating}
        error={createError}
        onClose={() => {
          setIsCreateOpen(false);
          setCreateError(null);
        }}
        onSubmit={async (payload) => {
          if (!session) {
            return;
          }
          setIsCreating(true);
          setCreateError(null);
          try {
            await rbacClient.createOrganization(session.token, payload);
            setStatusMessage(`Organization ${payload.name} was provisioned successfully.`);
            setIsCreateOpen(false);
            await reload();
          } catch (caught) {
            setCreateError(caught instanceof Error ? caught.message : "Create organization failed");
          } finally {
            setIsCreating(false);
          }
        }}
      />

      <SudoConfirmModal
        organization={sudoTarget}
        busy={sudoBusy}
        onClose={() => setSudoTarget(null)}
        onConfirm={async () => {
          if (!session || !sudoTarget) {
            return;
          }
          setSudoBusy(true);
          try {
            const sudo = await rbacClient.sudo(session.token, sudoTarget.id);
            const parentSession: RbacSessionSnapshot = {
              token: session.token,
              user: session.user,
              sudoBanner: session.sudoBanner,
            };
            setSession({
              token: sudo.token,
              sudoBanner: `SUDO MODE — You are impersonating ${sudoTarget.name} Admin`,
              user: {
                id: `sudo-${sudoTarget.id}`,
                email: `sudo@${sudoTarget.id}`,
                fullName: `${sudoTarget.name} Admin`,
                role: "ORG_ADMIN",
                organizationId: sudoTarget.id,
              },
              parentSession,
            });
            router.push("/rbac/org-admin");
          } finally {
            setSudoBusy(false);
            setSudoTarget(null);
          }
        }}
      />
    </>
  );
}
