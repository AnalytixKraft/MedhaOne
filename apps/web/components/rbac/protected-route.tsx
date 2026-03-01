"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useRbacSession } from "@/components/rbac/session-provider";
import type { RbacRole } from "@/lib/rbac/client";

export function ProtectedRoute({
  allowedRoles,
  children,
}: {
  allowedRoles: RbacRole[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { session, loading } = useRbacSession();

  useEffect(() => {
    if (!loading && !session) {
      router.replace("/rbac/login");
    }
  }, [loading, router, session]);

  if (loading || !session) {
    return <div className="rounded-lg border bg-white p-6 text-sm text-slate-600">Loading RBAC session...</div>;
  }

  if (!allowedRoles.includes(session.user.role)) {
    return <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">Forbidden for role {session.user.role}.</div>;
  }

  return <>{children}</>;
}
