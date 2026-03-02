"use client";

import { useEffect, useMemo, useState } from "react";

import { usePermissions } from "@/components/auth/permission-provider";
import { AppHeader } from "@/components/layout/header";
import { AppSidebar } from "@/components/layout/sidebar";
import { apiClient, type CompanySettings } from "@/lib/api/client";

type AppShellProps = {
  children: React.ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const { user } = usePermissions();
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
      if (!user?.organization_slug) {
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
  }, [user?.organization_slug]);

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
        <main className="flex-1 p-4 md:p-6">{children}</main>
        <footer className="border-t px-4 py-3 text-xs text-muted-foreground md:px-6">
          Powered by MedhaOne
        </footer>
      </div>
    </div>
  );
}
