"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { CreateOrganizationModal } from "@/components/rbac/super-admin/create-organization-modal";
import { EditOrganizationModal } from "@/components/rbac/super-admin/edit-organization-modal";
import { OrganizationsTable } from "@/components/rbac/super-admin/organizations-table";
import { SudoConfirmModal } from "@/components/rbac/super-admin/sudo-confirm-modal";
import { useSuperAdminOrganizations } from "@/components/rbac/super-admin/use-super-admin-organizations";
import { useRbacSession } from "@/components/rbac/session-provider";
import { rbacClient, type RbacSessionSnapshot } from "@/lib/rbac/client";
import {
  buildOrganizationDashboardRecords,
  type OrganizationDashboardRecord,
} from "@/lib/rbac/super-admin";

export function SuperAdminOrganizationsView() {
  const { session, setSession } = useRbacSession();
  const router = useRouter();
  const { organizations, loading, error, reload } = useSuperAdminOrganizations();
  const records = useMemo(() => buildOrganizationDashboardRecords(organizations), [organizations]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editOrg, setEditOrg] = useState<OrganizationDashboardRecord | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [sudoTarget, setSudoTarget] = useState<OrganizationDashboardRecord | null>(null);
  const [sudoBusy, setSudoBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  return (
    <>
      <div className="space-y-6">
        <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600 dark:text-sky-400">
              Organizations
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
              Tenant management
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
              Provision new organizations, manage capacity, reset tenant admins, and control impersonation access.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
            className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
          >
            Create Organization
          </button>
        </section>

        {statusMessage ? (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">
            {statusMessage}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-3xl border border-slate-200/80 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="grid gap-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-14 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
              ))}
            </div>
          </div>
        ) : (
          <OrganizationsTable
            organizations={records}
            nestedSudo={Boolean(session?.sudoBanner)}
            onViewDetails={(organization) => {
              setEditError(null);
              setEditOrg(organization);
            }}
            onEditMaxUsers={async (organization) => {
              setEditError(null);
              setEditOrg(organization);
            }}
            onSudo={(organization) => setSudoTarget(organization)}
            onViewAuditLogs={(organization) => router.push(`/rbac/super-admin/audit-logs?organization=${organization.id}`)}
            onDelete={async (organization) => {
              if (!session || !window.confirm(`Archive ${organization.name}? The schema will be renamed to del_${organization.id}.`)) {
                return;
              }
              try {
                await rbacClient.deleteOrganization(session.token, organization.id);
                setStatusMessage(`Archived ${organization.name}. Schema renamed to del_${organization.id}.`);
                if (editOrg?.id === organization.id) {
                  setEditOrg(null);
                }
                await reload();
              } catch (caught) {
                setEditError(caught instanceof Error ? caught.message : "Delete organization failed");
              }
            }}
          />
        )}
      </div>

      <CreateOrganizationModal
        open={createOpen}
        busy={createBusy}
        error={createError}
        onClose={() => {
          setCreateOpen(false);
          setCreateError(null);
        }}
        onSubmit={async (payload) => {
          if (!session) {
            return;
          }
          setCreateBusy(true);
          setCreateError(null);
          try {
            await rbacClient.createOrganization(session.token, payload);
            setStatusMessage(`Organization ${payload.name} was provisioned successfully.`);
            setCreateOpen(false);
            await reload();
          } catch (caught) {
            setCreateError(caught instanceof Error ? caught.message : "Create organization failed");
          } finally {
            setCreateBusy(false);
          }
        }}
      />

      <EditOrganizationModal
        open={Boolean(editOrg)}
        organization={editOrg}
        busy={editBusy}
        resetBusy={resetBusy}
        error={editError}
        onClose={() => {
          setEditOrg(null);
          setEditError(null);
        }}
        onSubmit={async (payload) => {
          if (!session || !editOrg) {
            return;
          }
          setEditBusy(true);
          setEditError(null);
          try {
            await rbacClient.updateOrganization(session.token, editOrg.id, payload);
            setStatusMessage(`Updated ${payload.name}.`);
            await reload();
            setEditOrg(null);
          } catch (caught) {
            setEditError(caught instanceof Error ? caught.message : "Update organization failed");
          } finally {
            setEditBusy(false);
          }
        }}
        onResetPassword={async (password) => {
          if (!session || !editOrg) {
            return;
          }
          setResetBusy(true);
          setEditError(null);
          try {
            const result = await rbacClient.resetOrganizationAdminPassword(session.token, editOrg.id, password);
            setStatusMessage(`Reset admin password for ${result.adminEmail}.`);
          } catch (caught) {
            setEditError(caught instanceof Error ? caught.message : "Reset admin password failed");
          } finally {
            setResetBusy(false);
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
