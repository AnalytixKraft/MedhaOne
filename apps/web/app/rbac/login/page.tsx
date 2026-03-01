"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useRbacSession } from "@/components/rbac/session-provider";
import { rbacClient } from "@/lib/rbac/client";

export default function RbacLoginPage() {
  const router = useRouter();
  const { setSession } = useRbacSession();
  const [email, setEmail] = useState("superadmin@medhaone.app");
  const [password, setPassword] = useState("ChangeThisImmediately!");
  const [organizationId, setOrganizationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const session = await rbacClient.login({
        email,
        password,
        organizationId: organizationId || undefined,
      });
      setSession(session);

      if (session.user.role === "SUPER_ADMIN") {
        router.push("/rbac/super-admin");
      } else if (session.user.role === "SERVICE_SUPPORT") {
        router.push("/rbac/support");
      } else {
        router.push("/rbac/org-admin");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Login failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">Multi-tenant RBAC Login</h1>
        <p className="mt-2 text-sm text-slate-600">Leave organization blank for super admin login.</p>
      </div>
      <form className="space-y-4 rounded-2xl border bg-white p-6" onSubmit={submit}>
        <input className="w-full rounded-md border px-3 py-2" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <input className="w-full rounded-md border px-3 py-2" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" />
        <input
          className="w-full rounded-md border px-3 py-2"
          value={organizationId}
          onChange={(e) => setOrganizationId(e.target.value.toLowerCase())}
          placeholder="Organization slug (leave blank for super admin)"
        />
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        <button disabled={pending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
