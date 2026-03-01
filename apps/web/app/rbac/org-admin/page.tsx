"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ProtectedRoute } from "@/components/rbac/protected-route";
import { useRbacSession } from "@/components/rbac/session-provider";
import { SudoBanner } from "@/components/rbac/sudo-banner";
import { rbacClient, type OrgUserRecord } from "@/lib/rbac/client";

export default function OrgAdminPage() {
  const { session, logout } = useRbacSession();
  const [users, setUsers] = useState<OrgUserRecord[]>([]);
  const [limit, setLimit] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: "user1@kraft.app",
    password: "ChangeThisImmediately!",
    fullName: "First User",
    role: "VIEW_ONLY" as "VIEW_ONLY" | "READ_WRITE" | "SERVICE_SUPPORT",
  });

  const load = useCallback(async () => {
    if (!session?.token) {
      return;
    }
    try {
      const nextUsers = await rbacClient.listUsers(session.token);
      setUsers(nextUsers);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load org users");
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!session?.user.organizationId) {
      return;
    }
    if (session.user.role !== "ORG_ADMIN") {
      return;
    }
    const fetchLimit = async () => {
      try {
        const superSession = null;
        void superSession;
      } catch {
        // limit display is optional in this scaffold when not holding a super-admin token
      }
    };
    void fetchLimit();
    setLimit(null);
  }, [session]);

  const usageText = useMemo(() => {
    if (limit == null) {
      return `${users.filter((user) => user.isActive).length} active users`;
    }
    return `${users.filter((user) => user.isActive).length} / ${limit} users used`;
  }, [limit, users]);

  return (
    <ProtectedRoute allowedRoles={["ORG_ADMIN"]}>
      <div className="mx-auto max-w-6xl space-y-8 px-6 py-10">
        <SudoBanner />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Org Admin Dashboard</h1>
            <p className="mt-2 text-sm text-slate-600">Manage users within the tenant schema and stay inside org limits.</p>
          </div>
          <button className="rounded-md border px-4 py-2 text-sm" onClick={logout}>Sign out</button>
        </div>

        <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600">Usage: {usageText}</div>

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <form
            className="space-y-3 rounded-2xl border bg-white p-6"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!session) {
                return;
              }
              try {
                setError(null);
                await rbacClient.createUser(session.token, form);
                await load();
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Failed to create user");
              }
            }}
          >
            <h2 className="text-lg font-semibold">Add user</h2>
            <input className="w-full rounded-md border px-3 py-2" value={form.fullName} onChange={(e) => setForm((current) => ({ ...current, fullName: e.target.value }))} placeholder="Full name" />
            <input className="w-full rounded-md border px-3 py-2" value={form.email} onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))} placeholder="Email" />
            <input className="w-full rounded-md border px-3 py-2" value={form.password} onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))} type="password" placeholder="Password" />
            <select className="w-full rounded-md border px-3 py-2" value={form.role} onChange={(e) => setForm((current) => ({ ...current, role: e.target.value as typeof current.role }))}>
              <option value="VIEW_ONLY">VIEW_ONLY</option>
              <option value="READ_WRITE">READ_WRITE</option>
              <option value="SERVICE_SUPPORT">SERVICE_SUPPORT</option>
            </select>
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">Add user</button>
          </form>

          <div className="rounded-2xl border bg-white p-6">
            <h2 className="text-lg font-semibold">Users</h2>
            <div className="mt-4 space-y-3">
              {users.map((user) => (
                <div key={user.id} className="rounded-xl border p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-slate-900">{user.fullName}</p>
                      <p className="text-sm text-slate-500">{user.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        className="rounded-md border px-2 py-1 text-sm"
                        value={user.role}
                        onChange={async (event) => {
                          if (!session) {
                            return;
                          }
                          await rbacClient.updateUserRole(session.token, user.id, event.target.value as "VIEW_ONLY" | "READ_WRITE" | "SERVICE_SUPPORT");
                          await load();
                        }}
                      >
                        <option value="VIEW_ONLY">VIEW_ONLY</option>
                        <option value="READ_WRITE">READ_WRITE</option>
                        <option value="SERVICE_SUPPORT">SERVICE_SUPPORT</option>
                      </select>
                      <button
                        className="rounded-md border px-3 py-1 text-sm"
                        onClick={async () => {
                          if (!session) {
                            return;
                          }
                          await rbacClient.updateUserStatus(session.token, user.id, !user.isActive);
                          await load();
                        }}
                      >
                        {user.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {users.length === 0 ? <p className="text-sm text-slate-500">No users yet.</p> : null}
            </div>
          </div>
        </section>
      </div>
    </ProtectedRoute>
  );
}
