"use client";

import { ShieldAlert } from "lucide-react";

import { useRbacSession } from "@/components/rbac/session-provider";

export function SudoBanner() {
  const { session, exitSudo } = useRbacSession();

  if (!session?.sudoBanner) {
    return null;
  }

  return (
    <div className="sticky top-[73px] z-20 mb-6 flex flex-col gap-3 rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-900 shadow-sm dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-100 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-2xl bg-white p-2 text-rose-600 dark:bg-slate-950/50 dark:text-rose-300">
          <ShieldAlert className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700 dark:text-rose-300">SUDO MODE</p>
          <p className="mt-1 font-medium">{session.sudoBanner}</p>
        </div>
      </div>
      <button
        className="rounded-2xl border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition duration-200 hover:scale-[1.01] hover:bg-rose-50 dark:border-rose-500/20 dark:bg-slate-950/50 dark:text-rose-200"
        onClick={exitSudo}
      >
        Exit sudo
      </button>
    </div>
  );
}
