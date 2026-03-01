"use client";

import { Dialog, DialogBackdrop, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { ShieldAlert, X } from "lucide-react";
import { Fragment } from "react";

import type { OrganizationDashboardRecord } from "@/lib/rbac/super-admin";

export function SudoConfirmModal({
  organization,
  onClose,
  onConfirm,
  busy,
}: {
  organization: OrganizationDashboardRecord | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  busy: boolean;
}) {
  return (
    <Transition appear show={Boolean(organization)} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <DialogBackdrop className="fixed inset-0 bg-slate-950/35 backdrop-blur-sm" />
        </TransitionChild>

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="translate-y-2 opacity-0"
            enterTo="translate-y-0 opacity-100"
            leave="ease-in duration-150"
            leaveFrom="translate-y-0 opacity-100"
            leaveTo="translate-y-2 opacity-0"
          >
            <DialogPanel className="relative w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
              <button
                className="absolute right-4 top-4 rounded-2xl border border-slate-200 p-2 text-slate-500 transition hover:scale-[1.02] hover:text-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:text-white"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex items-start gap-4">
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                  <ShieldAlert className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-600 dark:text-rose-300">Confirm sudo</p>
                  <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-slate-50">Impersonate ORG_ADMIN</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                    You are about to impersonate ORG_ADMIN of <span className="font-semibold text-slate-900 dark:text-slate-100">{organization?.name}</span>.
                    All actions will be written to the global audit log.
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                Current usage: {organization?.currentUsers ?? 0} / {organization?.maxUsers ?? 0} users
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:scale-[1.01] dark:border-slate-800 dark:text-slate-300"
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  className="rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition duration-200 hover:scale-[1.01] hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => {
                    void onConfirm();
                  }}
                  disabled={busy}
                >
                  {busy ? "Entering sudo..." : "Confirm sudo"}
                </button>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
