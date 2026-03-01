"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { rbacClient, type RbacSession } from "@/lib/rbac/client";

type RbacContextValue = {
  session: RbacSession | null;
  loading: boolean;
  setSession: (session: RbacSession | null) => void;
  logout: () => void;
  exitSudo: () => void;
};

const RbacSessionContext = createContext<RbacContextValue | undefined>(undefined);

export function RbacSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<RbacSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSessionState(rbacClient.loadSession());
    setLoading(false);
  }, []);

  const setSession = useCallback((nextSession: RbacSession | null) => {
    setSessionState(nextSession);
    if (nextSession) {
      rbacClient.saveSession(nextSession);
    } else {
      rbacClient.clearSession();
    }
  }, []);

  const logout = useCallback(() => setSession(null), [setSession]);
  const exitSudo = useCallback(() => {
    setSessionState((current) => {
      const nextSession = current?.parentSession ?? null;
      if (nextSession) {
        rbacClient.saveSession(nextSession);
      } else {
        rbacClient.clearSession();
      }
      return nextSession;
    });
  }, []);

  const value = useMemo(
    () => ({ session, loading, setSession, logout, exitSudo }),
    [session, loading, setSession, logout, exitSudo],
  );

  return <RbacSessionContext.Provider value={value}>{children}</RbacSessionContext.Provider>;
}

export function useRbacSession() {
  const value = useContext(RbacSessionContext);
  if (!value) {
    throw new Error("useRbacSession must be used inside RbacSessionProvider");
  }
  return value;
}
