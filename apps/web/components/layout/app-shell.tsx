"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

import { usePermissions } from "@/components/auth/permission-provider";
import { AppFooter } from "@/components/layout/app-footer";
import { AppHeader } from "@/components/layout/header";
import { AppSidebar } from "@/components/layout/sidebar";
import { apiClient, type CompanySettings } from "@/lib/api/client";
import { getRequiredPermissionForPath } from "@/lib/route-permissions";

type AppShellProps = {
  children: React.ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const { user, hasPermission, loading: permissionsLoading } = usePermissions();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  useEffect(() => {
    let cancelled = false;

    async function loadCompanySettings() {
      const canReadCompanySettings =
        !!user && (user.is_superuser || hasPermission("settings:view"));
      if (!user?.organization_slug || !canReadCompanySettings) {
        setCompanySettings(null);
        return;
      }

      try {
        const settings = await apiClient.getCompanySettings();
        if (!cancelled) {
          setCompanySettings(settings);
        }
      } catch {
        if (!cancelled) {
          setCompanySettings(null);
        }
      }
    }

    void loadCompanySettings();
    return () => {
      cancelled = true;
    };
  }, [hasPermission, user]);

  const brandName = useMemo(() => {
    const companyName = companySettings?.company_name?.trim();
    if (companyName) {
      return companyName;
    }
    const organizationName = companySettings?.organization_name?.trim();
    if (organizationName) {
      return organizationName;
    }
    const orgSlug = user?.organization_slug?.trim();
    if (orgSlug) {
      return orgSlug
        .split("_")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    }
    return "MedhaOne";
  }, [companySettings?.company_name, companySettings?.organization_name, user?.organization_slug]);

  const requiredPermission = getRequiredPermissionForPath(pathname);
  const waitingForPermissions = !!requiredPermission && permissionsLoading;
  const accessDenied =
    !!requiredPermission &&
    !!user &&
    !user.is_superuser &&
    !hasPermission(requiredPermission);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AppSidebar
        brandName={brandName}
        collapsed={collapsed}
        logoUrl={companySettings?.logo_url ?? null}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          brandName={brandName}
          onToggleDesktopSidebar={() => setCollapsed((prev) => !prev)}
          onToggleMobileSidebar={() => setMobileOpen((prev) => !prev)}
        />
        <main className="flex-1 p-4 md:p-6">
          {waitingForPermissions ? (
            <section className="rounded-3xl border bg-card p-6 text-sm text-muted-foreground">
              Loading access...
            </section>
          ) : accessDenied ? (
            <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-700">
              <h1 className="text-lg font-semibold">403 Forbidden</h1>
              <p className="mt-2 text-sm">
                You do not have permission to access this module.
              </p>
            </section>
          ) : (
            children
          )}
        </main>
        <AppFooter />
      </div>
    </div>
  );
}
