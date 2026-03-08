"use client";

import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  FileSearch,
  LayoutDashboard,
  PackageCheck,
  Settings,
  ShoppingCart,
  SquareStack,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { usePermissions } from "@/components/auth/permission-provider";
import {
  SidebarTreeMenu,
  type SidebarTreeMenuNode,
} from "@/components/layout/sidebar-tree-menu";
import {
  INVENTORY_MASTER_DATA_TAB,
  INVENTORY_REPORTS_TAB,
  INVENTORY_TABS,
} from "@/lib/inventory/navigation";
import { PURCHASE_NAV_ITEMS } from "@/lib/purchase/navigation";
import { SALES_NAV_ITEMS } from "@/lib/sales/navigation";
import { cn } from "@/lib/utils";

type NavNode = SidebarTreeMenuNode & {
  requiredPermission: string;
  children?: NavNode[];
};

const navItems: NavNode[] = [
  {
    id: "dashboard",
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    testId: "nav-dashboard",
    requiredPermission: "dashboard:view",
  },
  {
    id: "masters",
    href: "/masters",
    label: "Masters",
    icon: Building2,
    testId: "nav-masters",
    requiredPermission: "masters:view",
    children: INVENTORY_MASTER_DATA_TAB.items.map((item) => ({
      id: `masters-${item.id}`,
      label: item.label,
      href: item.href,
      testId: `nav-masters-${item.id}`,
      icon: item.icon,
      requiredPermission: item.requiredPermission,
    })),
  },
  {
    id: "purchase",
    href: "/purchase",
    label: "Purchase",
    icon: ShoppingCart,
    testId: "nav-purchase",
    requiredPermission: "purchase:view",
    children: PURCHASE_NAV_ITEMS.map((item) => ({
      id: `purchase-${item.id}`,
      label: item.label,
      href: item.href,
      testId: `nav-purchase-${item.id}`,
      icon: ShoppingCart,
      requiredPermission: item.requiredPermission,
    })),
  },
  {
    id: "sales",
    href: "/sales",
    label: "Sales",
    icon: PackageCheck,
    testId: "nav-sales",
    requiredPermission: "sales:view",
    children: SALES_NAV_ITEMS.map((item) => ({
      id: `sales-${item.id}`,
      label: item.label,
      href: item.href,
      testId: `nav-sales-${item.id}`,
      icon: item.icon,
      requiredPermission: item.requiredPermission,
    })),
  },
  {
    id: "inventory",
    href: "/inventory",
    label: "Inventory",
    icon: SquareStack,
    testId: "nav-inventory",
    requiredPermission: "inventory:view",
    children: INVENTORY_TABS.filter(
      (tab) => tab.id === "stock-operations" || tab.id === "setup",
    ).map((tab) => ({
      id: `inventory-${tab.id}`,
      label: tab.label,
      testId: `nav-inventory-${tab.id}`,
      href:
        tab.id === "stock-operations"
          ? "/inventory/stock-operations"
          : "/inventory/setup",
      icon: tab.icon,
      requiredPermission: "inventory:view",
      children: tab.items.map((item) => ({
        id: `inventory-${tab.id}-${item.id}`,
        label: item.label,
        href: item.href,
        testId: `nav-inventory-${tab.id}-${item.id}`,
        icon: item.icon,
        requiredPermission: item.requiredPermission,
      })),
    })),
  },
  {
    id: "reports",
    href: "/reports",
    label: "Reports",
    icon: BarChart3,
    testId: "nav-reports",
    requiredPermission: "reports:view",
    children: INVENTORY_REPORTS_TAB.items.map((item) => ({
      id: `reports-${item.id}`,
      label: item.label,
      href: item.href,
      testId: `nav-reports-${item.id}`,
      icon: item.icon,
      requiredPermission: item.requiredPermission,
    })),
  },
  {
    id: "settings",
    href: "/settings",
    label: "Settings",
    icon: Settings,
    testId: "nav-settings",
    requiredPermission: "settings:view",
    children: [
      {
        id: "settings-overview",
        href: "/settings",
        label: "Overview",
        icon: Settings,
        requiredPermission: "settings:view",
      },
      {
        id: "settings-audit-trail",
        href: "/settings/audit-trail",
        label: "Audit Trail",
        icon: FileSearch,
        requiredPermission: "audit:view",
      },
    ],
  },
];

type AppSidebarProps = {
  brandName: string;
  collapsed: boolean;
  logoUrl: string | null;
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

export function AppSidebar({
  brandName,
  collapsed,
  logoUrl,
  mobileOpen,
  onCloseMobile,
}: AppSidebarProps) {
  const { hasPermission: hasGrantedPermission, loading } = usePermissions();
  const pathname = usePathname();
  const [compactByViewport, setCompactByViewport] = useState(false);

  const hasPermission = useCallback(
    (code: string) => !loading && hasGrantedPermission(code),
    [hasGrantedPermission, loading],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setCompactByViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const compactDesktop = collapsed || compactByViewport;

  const visibleItems = useMemo(() => {
    const filterNode = (node: NavNode): SidebarTreeMenuNode | null => {
      if (!hasPermission(node.requiredPermission)) {
        return null;
      }

      const children = node.children
        ?.map(filterNode)
        .filter((child): child is SidebarTreeMenuNode => child !== null);

      if (children && children.length === 0 && !node.href) {
        return null;
      }

      return {
        id: node.id,
        label: node.label,
        href: node.href,
        icon: node.icon,
        testId: node.testId,
        children,
      };
    };

    return navItems
      .map(filterNode)
      .filter((item): item is SidebarTreeMenuNode => item !== null);
  }, [hasPermission]);

  return (
    <>
      <aside
        className={cn(
          "hidden border-r bg-background transition-all duration-300 md:block",
          compactDesktop ? "w-20" : "w-64",
        )}
      >
        <div className="flex h-16 items-center border-b px-4">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={brandName}
              className="h-9 w-9 rounded-xl border object-cover"
            />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border bg-muted text-sm font-semibold">
              {brandName.charAt(0).toUpperCase()}
            </span>
          )}
          <div className={cn("ml-3 min-w-0", compactDesktop && "sr-only")}>
            <p className="truncate text-sm font-semibold">{brandName}</p>
            <p className="text-xs text-muted-foreground">MedhaOne ERP</p>
          </div>
          <span className={cn("ml-3 text-lg font-bold", !compactDesktop && "hidden")}>
            {brandName.charAt(0).toUpperCase()}
          </span>
        </div>
        <nav className="p-3">
          <SidebarTreeMenu
            items={visibleItems}
            pathname={pathname}
            compact={compactDesktop}
          />
        </nav>
      </aside>

      <div
        className={cn(
          "fixed inset-0 z-40 md:hidden",
          mobileOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <button
          aria-label="Close navigation"
          className={cn(
            "absolute inset-0 bg-black/40 transition-opacity",
            mobileOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={onCloseMobile}
        />
        <aside
          className={cn(
            "absolute inset-y-0 left-0 w-72 border-r bg-background shadow-xl transition-transform duration-300",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex h-16 items-center justify-between border-b px-4">
            <div className="flex min-w-0 items-center gap-3">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={brandName}
                  className="h-9 w-9 rounded-xl border object-cover"
                />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border bg-muted text-sm font-semibold">
                  {brandName.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold">{brandName}</p>
                <p className="text-xs text-muted-foreground">MedhaOne ERP</p>
              </div>
            </div>
            <button
              aria-label="Close navigation"
              className="rounded-md p-2 hover:bg-muted"
              onClick={onCloseMobile}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav className="p-3">
            <SidebarTreeMenu
              items={visibleItems}
              pathname={pathname}
              compact={false}
              onNavigate={onCloseMobile}
              storageKey="medhaone.sidebar.tree.expanded.mobile"
            />
          </nav>
        </aside>
      </div>
    </>
  );
}
