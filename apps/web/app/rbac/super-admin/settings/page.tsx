import { LockKeyhole, ServerCog, ShieldCheck } from "lucide-react";

import { SuperAdminLayout } from "@/components/rbac/super-admin/layout";

const settings = [
  {
    icon: ShieldCheck,
    title: "Security posture",
    description: "Enforce stronger password baselines, monitor sudo frequency, and require secondary approval for high-risk tenant actions.",
  },
  {
    icon: ServerCog,
    title: "Provisioning defaults",
    description: "Define default tenant limits, schema lifecycle policies, and first-admin onboarding rules before new organizations are created.",
  },
  {
    icon: LockKeyhole,
    title: "Access controls",
    description: "Centralize token lifetimes, session revocation, and audit retention policies when the backend settings endpoints are introduced.",
  },
];

export default function SuperAdminSettingsPage() {
  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600 dark:text-sky-400">System settings</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Platform safeguards and defaults</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
            This screen is ready for future backend-backed configuration. The layout is in place so security and provisioning controls have a dedicated home.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          {settings.map((item) => {
            const Icon = item.icon;
            return (
              <section key={item.title} className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
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
