"use client";

import { Menu, MenuButton, MenuItem, MenuItems, Transition } from "@headlessui/react";
import { Bell, ChevronDown, LogOut, PanelLeft, Settings, ShieldCheck } from "lucide-react";
import { Fragment } from "react";

import { useRbacSession } from "@/components/rbac/session-provider";

export function SuperAdminHeader({
  onOpenMobile,
}: {
  onOpenMobile: () => void;
}) {
  const { session, logout } = useRbacSession();
  const initials = (session?.user.fullName ?? "SA")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-200/80 bg-white/90 px-4 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          className="rounded-2xl border border-slate-200 p-2 text-slate-500 transition hover:text-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:text-white lg:hidden"
          onClick={onOpenMobile}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Control Panel</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Tenant operations, access oversight, and platform controls.</p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <button className="rounded-2xl border border-slate-200 bg-white p-2.5 text-slate-500 transition duration-200 hover:scale-[1.02] hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-white">
          <Bell className="h-4 w-4" />
        </button>

        <Menu as="div" className="relative">
          <MenuButton className="inline-flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-2.5 py-2 text-left shadow-sm transition duration-200 hover:scale-[1.01] hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-900 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
              {initials}
            </div>
            <div className="hidden text-left sm:block">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{session?.user.fullName}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{session?.user.email}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </MenuButton>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-150"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-100"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            <MenuItems anchor="bottom end" className="z-50 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl outline-none dark:border-slate-800 dark:bg-slate-950">
              <MenuItem>
                {({ focus }) => (
                  <button className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm ${focus ? "bg-slate-100 text-slate-950 dark:bg-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-300"}`}>
                    <ShieldCheck className="h-4 w-4" />
                    <span>Super Admin</span>
                  </button>
                )}
              </MenuItem>
              <MenuItem>
                {({ focus }) => (
                  <button className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm ${focus ? "bg-slate-100 text-slate-950 dark:bg-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-300"}`}>
                    <Settings className="h-4 w-4" />
                    <span>Preferences</span>
                  </button>
                )}
              </MenuItem>
              <MenuItem>
                {({ focus }) => (
                  <button
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm ${focus ? "bg-slate-100 text-slate-950 dark:bg-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-300"}`}
                    onClick={logout}
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Sign out</span>
                  </button>
                )}
              </MenuItem>
            </MenuItems>
          </Transition>
        </Menu>
      </div>
    </header>
  );
}
