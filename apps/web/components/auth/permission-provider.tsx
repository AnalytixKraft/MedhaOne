"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { AuthUser, apiClient } from "@/lib/api/client";

type PermissionContextValue = {
  user: AuthUser | null;
  loading: boolean;
  hasPermission: (code: string) => boolean;
  refreshPermissions: () => Promise<void>;
};

const PermissionContext = createContext<PermissionContextValue | undefined>(undefined);

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshPermissions = useCallback(async () => {
    setLoading(true);
    try {
      const currentUser = await apiClient.getMe();
      setUser(currentUser);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPermissions();
  }, [refreshPermissions]);

  const hasPermission = useCallback(
    (code: string) => {
      if (!user) {
        return false;
      }
      if (user.is_superuser) {
        return true;
      }
      return user.permissions.includes(code);
    },
    [user],
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      hasPermission,
      refreshPermissions,
    }),
    [user, loading, hasPermission, refreshPermissions],
  );

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions() {
  const value = useContext(PermissionContext);
  if (!value) {
    throw new Error("usePermissions must be used inside PermissionProvider");
  }
  return value;
}
