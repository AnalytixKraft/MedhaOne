"use client";

import { useCallback, useEffect, useState } from "react";

import { useRbacSession } from "@/components/rbac/session-provider";
import { rbacClient, type OrganizationRecord } from "@/lib/rbac/client";

export function useSuperAdminOrganizations() {
  const { session } = useRbacSession();
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setError(null);
      setOrganizations(await rbacClient.listOrganizations(session.token));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load organizations");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    organizations,
    loading,
    error,
    reload: load,
  };
}
