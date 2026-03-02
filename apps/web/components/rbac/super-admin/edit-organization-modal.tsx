"use client";

import { Dialog, DialogBackdrop, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { Loader2, ShieldAlert, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";

import type { OrganizationDashboardRecord } from "@/lib/rbac/super-admin";

type FormState = {
  name: string;
  maxUsers: string;
  isActive: boolean;
  resetPassword: string;
};

export function EditOrganizationModal({
  open,
  organization,
  busy,
  resetBusy,
  error,
  onClose,
  onSubmit,
  onResetPassword,
}: {
  open: boolean;
  organization: OrganizationDashboardRecord | null;
  busy: boolean;
  resetBusy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: { name: string; maxUsers: number; isActive: boolean }) => Promise<void>;
  onResetPassword: (password: string) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>({
    name: "",
    maxUsers: "",
    isActive: true,
    resetPassword: "",
  });
  const [touched, setTouched] = useState(false);
  const [resetTouched, setResetTouched] = useState(false);

  useEffect(() => {
    if (!organization || !open) {
      return;
    }
    setForm({
      name: organization.name,
      maxUsers: String(organization.maxUsers),
      isActive: organization.isActive,
      resetPassword: "",
    });
    setTouched(false);
    setResetTouched(false);
  }, [open, organization]);

  const validation = useMemo(() => {
    const maxUsers = Number(form.maxUsers);
    return {
      name: form.name.trim().length >= 2 ? null : "Organization name is required.",
      maxUsers:
        Number.isFinite(maxUsers) && maxUsers >= (organization?.currentUsers ?? 0)
          ? null
          : `User limit must be at least ${organization?.currentUsers ?? 0}.`,
      resetPassword:
        form.resetPassword.length >= 12 ? null : "Password must be at least 12 characters.",
    };
  }, [form.maxUsers, form.name, form.resetPassword, organization?.currentUsers]);

  if (!organization) {
    return null;
  }

  return (
    <Transition appear show={open} as={Fragment}>
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
            enterFrom="translate-y-4 opacity-0"
            enterTo="translate-y-0 opacity-100"
            leave="ease-in duration-150"
            leaveFrom="translate-y-0 opacity-100"
            leaveTo="translate-y-4 opacity-0"
          >
            <DialogPanel className="w-full max-w-2xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                    Organization controls
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">
                    Edit {organization.name}
                  </h2>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Update org metadata, capacity, and admin access from the control plane.
                  </p>
                </div>
                <button
                  className="rounded-2xl border border-slate-200 p-2 text-slate-500 transition hover:text-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:text-white"
                  onClick={onClose}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <Field
                  label="Organization Name"
                  value={form.name}
                  onChange={(value) => setForm((current) => ({ ...current, name: value }))}
                  error={touched ? validation.name ?? undefined : undefined}
                />
                <Field
                  label="Max Users"
                  type="number"
                  value={form.maxUsers}
                  onChange={(value) => setForm((current) => ({ ...current, maxUsers: value }))}
                  error={touched ? validation.maxUsers ?? undefined : undefined}
                  helper={`Current usage: ${organization.currentUsers} / ${organization.maxUsers}`}
                />
                <label className="block space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Status
                  </span>
                  <select
                    value={form.isActive ? "ACTIVE" : "DISABLED"}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        isActive: event.target.value === "ACTIVE",
                      }))
                    }
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="DISABLED">Disabled</option>
                  </select>
                </label>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  Schema: <span className="font-medium">{organization.schemaName}</span>
                </div>
              </div>

              {error ? (
                <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
                  {error}
                </div>
              ) : null}

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition dark:border-slate-800 dark:text-slate-300"
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                  disabled={busy}
                  onClick={async () => {
                    setTouched(true);
                    if (validation.name || validation.maxUsers) {
                      return;
                    }
                    await onSubmit({
                      name: form.name.trim(),
                      maxUsers: Number(form.maxUsers),
                      isActive: form.isActive,
                    });
                  }}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  <span>{busy ? "Saving..." : "Save Organization"}</span>
                </button>
              </div>

              <div className="mt-8 rounded-3xl border border-amber-200 bg-amber-50/80 p-5 dark:border-amber-500/20 dark:bg-amber-500/10">
                <div className="flex items-start gap-3">
                  <span className="rounded-2xl border border-amber-200 bg-white p-2 text-amber-700 dark:border-amber-500/20 dark:bg-slate-950 dark:text-amber-300">
                    <ShieldAlert className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">Reset Admin Password</h3>
                    <p className="mt-1 text-sm text-amber-800/80 dark:text-amber-200/80">
                      This updates the first ORG_ADMIN account in the tenant schema and writes a global audit event.
                    </p>
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                      <div className="flex-1">
                        <Field
                          label="New Password"
                          type="password"
                          value={form.resetPassword}
                          onChange={(value) => setForm((current) => ({ ...current, resetPassword: value }))}
                          error={resetTouched ? validation.resetPassword ?? undefined : undefined}
                        />
                      </div>
                      <button
                        type="button"
                        disabled={resetBusy}
                        className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-amber-300 px-4 text-sm font-medium text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-400/30 dark:text-amber-100 dark:hover:bg-amber-400/10"
                        onClick={async () => {
                          setResetTouched(true);
                          if (validation.resetPassword) {
                            return;
                          }
                          await onResetPassword(form.resetPassword);
                          setForm((current) => ({ ...current, resetPassword: "" }));
                          setResetTouched(false);
                        }}
                      >
                        {resetBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        <span>{resetBusy ? "Resetting..." : "Reset Admin Password"}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  helper,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  helper?: string;
  type?: "text" | "number" | "password";
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
      />
      {helper ? <p className="text-xs text-slate-500 dark:text-slate-400">{helper}</p> : null}
      {error ? <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p> : null}
    </label>
  );
}
