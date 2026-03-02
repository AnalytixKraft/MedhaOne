"use client";

import { useEffect, useState } from "react";

import { AuditLogTable } from "@/components/rbac/super-admin/audit-log-table";
import { SuperAdminLayout } from "@/components/rbac/super-admin/layout";
import { useRbacSession } from "@/components/rbac/session-provider";
import { rbacClient, type GlobalAuditLogRecord } from "@/lib/rbac/client";

export default function SuperAdminAuditLogsPage() {
  const { session } = useRbacSession();
  const [logs, setLogs] = useState<GlobalAuditLogRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const organization = params.get("organization") ?? undefined;
    setOrganizationId(organization);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!session?.token) {
        return;
      }

      try {
        setError(null);
        const response = await rbacClient.listOrganizationAuditLogs(session.token, organizationId);
        if (!cancelled) {
          setLogs(response);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Failed to load audit logs");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [organizationId, session?.token]);

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600 dark:text-sky-400">
            Audit logs
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
            Security and control-plane activity
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
            Review platform actions, password resets, capacity changes, and tenant-sensitive operations.
          </p>
        </div>

        {error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <AuditLogTable logs={logs} />
      </div>
    </SuperAdminLayout>
  );
}
