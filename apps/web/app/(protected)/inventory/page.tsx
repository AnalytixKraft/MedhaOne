"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { AppTabs } from "@/components/erp/app-primitives";
import { usePermissions } from "@/components/auth/permission-provider";
import { PageTitle } from "@/components/layout/page-title";
import {
  getInventoryWorkspaceTabById,
  INVENTORY_WORKSPACE_TABS,
} from "@/lib/inventory/navigation";
export default function InventoryPage() {
  const { user, hasPermission } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeTab = getInventoryWorkspaceTabById(searchParams.get("tab"));

  const visibleTabs = useMemo(
    () =>
      INVENTORY_WORKSPACE_TABS.map((tab) => ({
        ...tab,
        items: tab.items.filter(
          (item) => !!user && (user.is_superuser || hasPermission(item.requiredPermission)),
        ),
      })).filter((tab) => tab.items.length > 0),
    [hasPermission, user],
  );

  const selectedTab =
    visibleTabs.find((tab) => tab.id === activeTab.id) ?? visibleTabs[0] ?? null;
  const SelectedTabIcon = selectedTab?.icon;

  const setTab = (tabId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tabId);
    const suffix = params.toString();
    router.replace(suffix ? `${pathname}?${suffix}` : pathname);
  };

  return (
    <div className="space-y-4">
      <PageTitle
        title="Inventory"
        description="Structured module navigation for stock operations and inventory setup."
      />

      <AppTabs
        tabs={visibleTabs.map((tab) => ({ id: tab.id, label: tab.label }))}
        value={selectedTab?.id ?? (visibleTabs[0]?.id ?? "setup")}
        onChange={setTab}
        className="sticky top-0 z-20"
      />

      {selectedTab ? (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            {SelectedTabIcon ? (
              <SelectedTabIcon className="h-5 w-5 text-muted-foreground" />
            ) : null}
            <h2 className="text-lg font-semibold">{selectedTab.label}</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {selectedTab.items.map((item) => {
              const ItemIcon = item.icon;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  data-testid={`inventory-${item.id}-card`}
                  className="group rounded-2xl border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="rounded-xl border p-2 text-muted-foreground">
                      <ItemIcon className="h-5 w-5" />
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold">{item.label}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                </Link>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
          No inventory modules are available for your role.
        </section>
      )}
    </div>
  );
}
