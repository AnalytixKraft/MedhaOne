"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { ProtectedRoute } from "@/components/rbac/protected-route";
import { useRbacSession } from "@/components/rbac/session-provider";
import { SudoBanner } from "@/components/rbac/sudo-banner";
import { SuperAdminHeader } from "@/components/rbac/super-admin/header";
import { SuperAdminSidebar } from "@/components/rbac/super-admin/sidebar";
import { cn } from "@/lib/utils";

export function SuperAdminLayout({ children }: { children: ReactNode }) {
  const { session } = useRbacSession();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <ProtectedRoute allowedRoles={["SUPER_ADMIN"]}>
      <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
        <div
          className={cn(
            "mx-auto flex min-h-screen max-w-[1680px] rounded-none transition-colors duration-200 lg:px-4 lg:py-4",
            session?.sudoBanner && "lg:p-4",
          )}
        >
          <div
            className={cn(
              "flex min-h-screen w-full overflow-hidden border border-transparent bg-white/80 shadow-[0_10px_40px_-24px_rgba(15,23,42,0.18)] backdrop-blur dark:bg-slate-950/80 lg:rounded-[28px]",
              session?.sudoBanner && "border-rose-200 dark:border-rose-500/20",
            )}
          >
            <SuperAdminSidebar
              collapsed={collapsed}
              mobileOpen={mobileOpen}
              onCloseMobile={() => setMobileOpen(false)}
              onToggleCollapsed={() => setCollapsed((current) => !current)}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <SuperAdminHeader onOpenMobile={() => setMobileOpen(true)} />
              <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
                <SudoBanner />
                <div className="transition-opacity duration-200 opacity-100">{children}</div>
              </main>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
