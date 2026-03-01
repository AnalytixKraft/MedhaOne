"use client";

import { Dialog, DialogBackdrop, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { Loader2, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";

type FormState = {
  id: string;
  name: string;
  maxUsers: string;
  adminFullName: string;
  adminEmail: string;
  adminPassword: string;
};

const initialState: FormState = {
  id: "",
  name: "",
  maxUsers: "",
  adminFullName: "",
  adminEmail: "",
  adminPassword: "",
};

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function CreateOrganizationModal({
  open,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: {
    id: string;
    name: string;
    maxUsers: number;
    adminFullName: string;
    adminEmail: string;
    adminPassword: string;
  }) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(initialState);
  const [touched, setTouched] = useState(false);
  const [slugEdited, setSlugEdited] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm(initialState);
    setTouched(false);
    setSlugEdited(false);
  }, [open]);

  const fieldErrors = useMemo(() => {
    const nextErrors: Partial<Record<keyof FormState, string>> = {};

    if (!/^[a-z0-9_]+$/.test(form.id)) {
      nextErrors.id = "Slug must be lowercase letters, numbers, or underscores.";
    }
    if (form.name.trim().length < 2) {
      nextErrors.name = "Organization name is required.";
    }
    if (!Number.isFinite(Number(form.maxUsers)) || Number(form.maxUsers) < 1) {
      nextErrors.maxUsers = "Max users must be at least 1.";
    }
    if (form.adminFullName.trim().length < 2) {
      nextErrors.adminFullName = "Admin name is required.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail)) {
      nextErrors.adminEmail = "A valid admin email is required.";
    }
    if (form.adminPassword.length < 12) {
      nextErrors.adminPassword = "Password must be at least 12 characters.";
    }

    return nextErrors;
  }, [form]);

  const isValid = Object.keys(fieldErrors).length === 0;

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

        <div className="fixed inset-0 flex items-center justify-end p-0 sm:p-4">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="translate-x-10 opacity-0"
            enterTo="translate-x-0 opacity-100"
            leave="ease-in duration-150"
            leaveFrom="translate-x-0 opacity-100"
            leaveTo="translate-x-10 opacity-0"
          >
            <DialogPanel className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950 sm:h-auto sm:max-h-[92vh] sm:rounded-[28px] sm:border sm:shadow-[0_20px_60px_-30px_rgba(15,23,42,0.35)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Provision organization</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">Create organization</h2>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Bootstrap a tenant schema and its first admin with production-safe defaults.
                  </p>
                </div>
                <button
                  className="rounded-2xl border border-slate-200 p-2 text-slate-500 transition hover:scale-[1.02] hover:text-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:text-white"
                  onClick={onClose}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form
                className="mt-8 space-y-5"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setTouched(true);
                  if (!isValid || busy) {
                    return;
                  }

                  await onSubmit({
                    id: form.id,
                    name: form.name,
                    maxUsers: Number(form.maxUsers),
                    adminFullName: form.adminFullName,
                    adminEmail: form.adminEmail,
                    adminPassword: form.adminPassword,
                  });
                }}
              >
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    label="Organization Name"
                    value={form.name}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        name: value,
                        id: slugEdited ? current.id : normalizeSlug(value),
                      }))
                    }
                    error={touched ? fieldErrors.name : undefined}
                    placeholder="Kraft Distribution"
                  />
                  <Field
                    label="Slug"
                    value={form.id}
                    onChange={(value) => {
                      setSlugEdited(true);
                      setForm((current) => ({ ...current, id: normalizeSlug(value) }));
                    }}
                    error={touched ? fieldErrors.id : undefined}
                    placeholder="kraft"
                  />
                  <Field
                    label="Max Users"
                    value={form.maxUsers}
                    type="number"
                    onChange={(value) => setForm((current) => ({ ...current, maxUsers: value }))}
                    error={touched ? fieldErrors.maxUsers : undefined}
                    placeholder="25"
                  />
                  <Field
                    label="Admin Name"
                    value={form.adminFullName}
                    onChange={(value) => setForm((current) => ({ ...current, adminFullName: value }))}
                    error={touched ? fieldErrors.adminFullName : undefined}
                    placeholder="Kraft Admin"
                  />
                  <Field
                    label="Admin Email"
                    value={form.adminEmail}
                    onChange={(value) => setForm((current) => ({ ...current, adminEmail: value }))}
                    error={touched ? fieldErrors.adminEmail : undefined}
                    placeholder="orgadmin@kraft.app"
                  />
                  <Field
                    label="Admin Password"
                    value={form.adminPassword}
                    type="password"
                    onChange={(value) => setForm((current) => ({ ...current, adminPassword: value }))}
                    error={touched ? fieldErrors.adminPassword : undefined}
                    placeholder="Minimum 12 characters"
                  />
                </div>

                {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">{error}</p> : null}

                <div className="flex items-center justify-between gap-3 pt-4">
                  <button
                    type="button"
                    className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:scale-[1.01] dark:border-slate-800 dark:text-slate-300"
                    onClick={onClose}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition duration-200 hover:scale-[1.01] hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    <span>{busy ? "Creating..." : "Create organization"}</span>
                  </button>
                </div>
              </form>
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
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  type?: "text" | "number" | "password";
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      />
      {error ? <span className="text-sm text-rose-600">{error}</span> : null}
    </label>
  );
}
