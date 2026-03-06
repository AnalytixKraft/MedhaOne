"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, LockKeyhole, ServerCog, ShieldCheck } from "lucide-react";

import { useRbacSession } from "@/components/rbac/session-provider";
import { SuperAdminLayout } from "@/components/rbac/super-admin/layout";
import {
  rbacClient,
  type GlobalTaxRateTemplate,
} from "@/lib/rbac/client";

type TaxFormState = {
  code: string;
  label: string;
  ratePercent: string;
  isActive: boolean;
};

const emptyTaxForm: TaxFormState = {
  code: "",
  label: "",
  ratePercent: "",
  isActive: true,
};

const settings = [
  {
    icon: ServerCog,
    title: "Provisioning defaults",
    description:
      "Global GST templates are copied into each new organization and can be customized later by org admins.",
  },
  {
    icon: ShieldCheck,
    title: "Security posture",
    description:
      "Audit and impersonation controls continue to be managed in the existing super admin governance screens.",
  },
  {
    icon: LockKeyhole,
    title: "Access controls",
    description:
      "Token and session policies remain scoped to auth settings and are not impacted by tax template updates.",
  },
];

export default function SuperAdminSettingsPage() {
  const { session } = useRbacSession();
  const [templates, setTemplates] = useState<GlobalTaxRateTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TaxFormState>(emptyTaxForm);
  const [editingOriginal, setEditingOriginal] = useState<GlobalTaxRateTemplate | null>(null);

  const loadTemplates = useCallback(async () => {
    if (!session?.token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setError(null);
      setTemplates(await rbacClient.listGlobalTaxRates(session.token));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load global GST templates");
    } finally {
      setLoading(false);
    }
  }, [session?.token]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const formError = useMemo(() => {
    const nextCode = form.code.trim().toUpperCase();
    const originalCode = editingOriginal?.code.trim().toUpperCase();
    const shouldValidateCode = !editingId || originalCode === undefined || nextCode !== originalCode;

    if (shouldValidateCode) {
      if (!nextCode) {
        return "Code is required.";
      }
      if (!/^[A-Z0-9_]+$/.test(nextCode)) {
        return "Code must use uppercase letters, numbers, or underscore.";
      }
    }
    if (!form.label.trim()) {
      return "Label is required.";
    }
    const rate = Number.parseFloat(form.ratePercent);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return "Rate percent must be between 0 and 100.";
    }
    return null;
  }, [editingId, editingOriginal?.code, form.code, form.label, form.ratePercent]);

  const startEdit = (template: GlobalTaxRateTemplate) => {
    setEditingId(template.id);
    setEditingOriginal(template);
    setForm({
      code: template.code,
      label: template.label,
      ratePercent: Number.parseFloat(template.ratePercent).toString(),
      isActive: template.isActive,
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setEditingOriginal(null);
    setForm(emptyTaxForm);
  };

  const saveTemplate = async () => {
    if (!session?.token || formError) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        label: form.label.trim(),
        ratePercent: Number.parseFloat(form.ratePercent),
        isActive: form.isActive,
      };

      if (editingId) {
        const patch: Partial<{
          code: string;
          label: string;
          ratePercent: number;
          isActive: boolean;
        }> = {};
        const nextCode = form.code.trim().toUpperCase();
        if (editingOriginal?.code !== nextCode) {
          patch.code = nextCode;
        }
        if (editingOriginal?.label !== payload.label) {
          patch.label = payload.label;
        }
        if (
          editingOriginal &&
          Math.abs(Number.parseFloat(editingOriginal.ratePercent) - payload.ratePercent) >
            0.000_001
        ) {
          patch.ratePercent = payload.ratePercent;
        }
        if (editingOriginal?.isActive !== payload.isActive) {
          patch.isActive = payload.isActive;
        }

        await rbacClient.updateGlobalTaxRate(session.token, editingId, patch);
        setStatusMessage("Global template updated.");
      } else {
        await rbacClient.createGlobalTaxRate(session.token, {
          code: form.code.trim().toUpperCase(),
          ...payload,
        });
        setStatusMessage("Global template created.");
      }

      resetForm();
      await loadTemplates();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save global template");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600 dark:text-sky-400">
            System settings
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
            Platform safeguards and defaults
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
            These GST slabs are template defaults for new organizations. Existing tenants maintain
            independent tax masters.
          </p>
        </div>

        {statusMessage ? (
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            {statusMessage}
          </p>
        ) : null}

        {error ? (
          <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <section className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
            <h3 className="text-lg font-semibold text-slate-950 dark:text-slate-50">
              Global GST Template Rates
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Copied into tenant tax masters during organization provisioning.
            </p>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Code</span>
              <input
                value={form.code}
                onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
                placeholder="GST_10"
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Label</span>
              <input
                value={form.label}
                onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
                placeholder="GST 10%"
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Rate %</span>
              <input
                value={form.ratePercent}
                onChange={(event) =>
                  setForm((current) => ({ ...current, ratePercent: event.target.value }))
                }
                placeholder="10"
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-right text-sm text-slate-900 outline-none transition focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm((current) => ({ ...current, isActive: event.target.checked }))
                }
              />
              Active
            </label>
            <button
              type="button"
              disabled={saving || Boolean(formError)}
              onClick={() => void saveTemplate()}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editingId ? "Update Template" : "Add Template"}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                className="h-10 rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel Edit
              </button>
            ) : null}
            {formError ? (
              <span className="text-sm text-rose-600 dark:text-rose-400">{formError}</span>
            ) : null}
          </div>

          {loading ? (
            <div className="mt-5 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading templates...
            </div>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-y-2">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Label</th>
                    <th className="px-3 py-2 text-right">Rate %</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((template) => (
                    <tr key={template.id} className="rounded-2xl bg-slate-50 dark:bg-slate-950/60">
                      <td className="px-3 py-3 text-sm font-medium text-slate-900 dark:text-slate-100">{template.code}</td>
                      <td className="px-3 py-3 text-sm text-slate-700 dark:text-slate-300">{template.label}</td>
                      <td className="px-3 py-3 text-right text-sm tabular-nums text-slate-700 dark:text-slate-300">
                        {Number.parseFloat(template.ratePercent).toFixed(2)}
                      </td>
                      <td className="px-3 py-3">
                        <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {template.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => startEdit(template)}
                          disabled={false}
                          aria-label={`Edit ${template.code}`}
                          className="inline-flex cursor-pointer items-center justify-center rounded-md px-2 py-1 text-sm font-semibold text-sky-600 transition hover:bg-sky-50 hover:text-sky-500 dark:text-sky-400 dark:hover:bg-slate-800/70"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid gap-6 xl:grid-cols-3">
          {settings.map((item) => {
            const Icon = item.icon;
            return (
              <section
                key={item.title}
                className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="rounded-2xl bg-sky-50 p-3 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-slate-950 dark:text-slate-50">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{item.description}</p>
              </section>
            );
          })}
        </div>
      </div>
    </SuperAdminLayout>
  );
}
