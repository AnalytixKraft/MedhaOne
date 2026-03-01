"use client";

import { Dialog, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { ChevronLeft, ChevronRight, PanelLeftClose, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { BarChart3, Building2, FileSearch, LayoutGrid, Settings2, Shield } from "lucide-react";

import { cn } from "@/lib/utils";

const items = [
  { href: "/rbac/super-admin", label: "Dashboard", icon: LayoutGrid },
  { href: "/rbac/super-admin/organizations", label: "Organizations", icon: Building2 },
  { href: "/rbac/super-admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/rbac/super-admin/audit-logs", label: "Audit Logs", icon: FileSearch },
  { href: "/rbac/super-admin/settings", label: "System Settings", icon: Settings2 },
];

export function SuperAdminSidebar({
  collapsed,
  mobileOpen,
  onCloseMobile,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onToggleCollapsed: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      <aside
        className={cn(
          "hidden shrink-0 border-r border-slate-200/80 bg-white/80 px-4 py-5 transition-all duration-300 dark:border-slate-800 dark:bg-slate-950/80 lg:flex lg:flex-col",
          collapsed ? "w-24" : "w-72",
        )}
      >
        <DesktopSidebarContent pathname={pathname} collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
      </aside>

      <Transition appear show={mobileOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50 lg:hidden" onClose={onCloseMobile}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-slate-950/35 backdrop-blur-sm" />
          </TransitionChild>

          <div className="fixed inset-0 flex">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="-translate-x-full opacity-0"
              enterTo="translate-x-0 opacity-100"
              leave="ease-in duration-150"
              leaveFrom="translate-x-0 opacity-100"
              leaveTo="-translate-x-full opacity-0"
            >
              <DialogPanel className="flex h-full w-80 max-w-[88vw] flex-col border-r border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
                <div className="mb-6 flex items-center justify-between">
                  <Brand collapsed={false} />
                  <button
                    className="rounded-2xl border border-slate-200 p-2 text-slate-500 dark:border-slate-800 dark:text-slate-400"
                    onClick={onCloseMobile}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <NavList pathname={pathname} collapsed={false} onNavigate={onCloseMobile} />
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}

function DesktopSidebarContent({
  pathname,
  collapsed,
  onToggleCollapsed,
}: {
  pathname: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <>
      <div className="mb-8 flex items-center justify-between gap-3">
        <Brand collapsed={collapsed} />
        <button
          className="rounded-2xl border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:text-white"
          onClick={onToggleCollapsed}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <NavList pathname={pathname} collapsed={collapsed} />

      <button className="mt-auto inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-500 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:text-white">
        <PanelLeftClose className="h-4 w-4" />
        <span className={cn(collapsed && "hidden")}>Navigation pinned</span>
      </button>
    </>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-3xl border border-slate-200/80 bg-white px-3 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900", collapsed && "justify-center") }>
      <div className="rounded-2xl bg-slate-900 p-2 text-white dark:bg-slate-100 dark:text-slate-900">
        <Shield className="h-4 w-4" />
      </div>
      <div className={cn(collapsed && "hidden")}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">MedhaOne</p>
        <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">Control</p>
      </div>
    </div>
  );
}

function NavList({
  pathname,
  collapsed,
  onNavigate,
}: {
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="space-y-1.5">
      {items.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-slate-600 transition duration-200 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white",
              active && "bg-slate-100 text-slate-950 dark:bg-slate-900 dark:text-white",
              collapsed && "justify-center",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className={cn(collapsed && "hidden")}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
