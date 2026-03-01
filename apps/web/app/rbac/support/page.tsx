"use client";

import { useCallback, useEffect, useState } from "react";

import { ProtectedRoute } from "@/components/rbac/protected-route";
import { useRbacSession } from "@/components/rbac/session-provider";
import { SudoBanner } from "@/components/rbac/sudo-banner";
import { rbacClient, type OrgUserRecord } from "@/lib/rbac/client";

export default function ServiceSupportPage() {
  const { session, logout } = useRbacSession();
  const [users, setUsers] = useState<OrgUserRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      return;
    }
    try {
      setUsers(await rbacClient.listUsers(session.token));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load users");
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ProtectedRoute allowedRoles={["SERVICE_SUPPORT"]}>
      <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
        <SudoBanner />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Service Support Dashboard</h1>
            <p className="mt-2 text-sm text-slate-600">Read-only access to tenant users.</p>
          </div>
          <button className="rounded-md border px-4 py-2 text-sm" onClick={logout}>Sign out</button>
        </div>
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        <div className="rounded-2xl border bg-white p-6">
          <div className="space-y-3">
            {users.map((user) => (
              <div key={user.id} className="rounded-xl border p-4">
                <p className="font-medium text-slate-900">{user.fullName}</p>
                <p className="text-sm text-slate-500">{user.email}</p>
                <p className="mt-2 text-xs uppercase tracking-wide text-slate-500">{user.role}</p>
              </div>
            ))}
            {users.length === 0 ? <p className="text-sm text-slate-500">No users found.</p> : null}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
