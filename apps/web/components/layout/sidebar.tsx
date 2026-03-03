"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  LayoutDashboard,
  Settings,
  ShoppingCart,
  Warehouse,
  X,
} from "lucide-react";

import { usePermissions } from "@/components/auth/permission-provider";
import { cn } from "@/lib/utils";

const navItems = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    testId: undefined,
    requiredPermission: "dashboard:view",
  },
  {
    href: "/masters",
    label: "Masters",
    icon: Building2,
    testId: "nav-masters",
    requiredPermission: "masters:view",
  },
  {
    href: "/purchase",
    label: "Purchase",
    icon: ShoppingCart,
    testId: "nav-purchase",
    requiredPermission: "purchase:view",
  },
  {
    href: "/inventory",
    label: "Inventory",
    icon: Warehouse,
    testId: undefined,
    requiredPermission: "inventory:view",
  },
  {
    href: "/reports",
    label: "Reports",
    icon: BarChart3,
    testId: undefined,
    requiredPermission: "reports:view",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    testId: undefined,
    requiredPermission: "settings:view",
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

  function hasPermission(code: string) {
    return !loading && hasGrantedPermission(code);
  }

  const visibleItems = navItems.filter((item) => hasPermission(item.requiredPermission));

  return (
    <>
      <aside
        className={cn(
          "hidden border-r bg-background transition-all duration-300 md:block",
          collapsed ? "w-20" : "w-64",
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
          <div className={cn("ml-3 min-w-0", collapsed && "sr-only")}>
            <p className="truncate text-sm font-semibold">{brandName}</p>
            <p className="text-xs text-muted-foreground">MedhaOne ERP</p>
          </div>
          <span className={cn("ml-3 text-lg font-bold", !collapsed && "hidden")}>
            {brandName.charAt(0).toUpperCase()}
          </span>
        </div>
        <nav className="space-y-1 p-3">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={item.testId}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  active && "bg-muted text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={cn(collapsed && "hidden")}>{item.label}</span>
              </Link>
            );
          })}
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
          <nav className="space-y-1 p-3">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <Link
                  key={`mobile-${item.href}`}
                  href={item.href}
                  onClick={onCloseMobile}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    active && "bg-muted text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>
      </div>
    </>
  );
}
