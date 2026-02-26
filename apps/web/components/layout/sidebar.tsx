"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, LayoutDashboard, Settings, ShoppingCart, Truck, Warehouse, X } from "lucide-react";

import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/masters", label: "Masters", icon: Building2 },
  { href: "/purchase", label: "Purchase", icon: ShoppingCart },
  { href: "/sales", label: "Sales", icon: Truck },
  { href: "/warehouse", label: "Warehouse", icon: Warehouse },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

type AppSidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

export function AppSidebar({ collapsed, mobileOpen, onCloseMobile }: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <>
      <aside
        className={cn(
          "hidden border-r bg-background transition-all duration-300 md:block",
          collapsed ? "w-20" : "w-64",
        )}
      >
        <div className="flex h-16 items-center border-b px-4">
          <span className={cn("font-semibold", collapsed && "sr-only")}>MedhaOne</span>
          <span className={cn("text-lg font-bold", !collapsed && "hidden")}>M1</span>
        </div>
        <nav className="space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
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
            <span className="font-semibold">MedhaOne</span>
            <button aria-label="Close navigation" className="rounded-md p-2 hover:bg-muted" onClick={onCloseMobile}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav className="space-y-1 p-3">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

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
