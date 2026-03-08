"use client";

import { Dialog, DialogBackdrop, DialogPanel, Transition, TransitionChild } from "@headlessui/react";

import { Button } from "@/components/ui/button";
import type { AuditLogDetail } from "@/lib/api/client";

type AuditLogDrawerProps = {
  open: boolean;
  onClose: () => void;
  log: AuditLogDetail | null;
};

export function AuditLogDrawer({ open, onClose, log }: AuditLogDrawerProps) {
  return (
    <Transition show={open}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <TransitionChild
          enter="transition-opacity duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition-opacity duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <DialogBackdrop className="fixed inset-0 bg-slate-950/35 backdrop-blur-sm" />
        </TransitionChild>
        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 flex justify-end">
            <TransitionChild
              enter="transform transition duration-200"
              enterFrom="translate-x-full"
              enterTo="translate-x-0"
              leave="transform transition duration-150"
              leaveFrom="translate-x-0"
              leaveTo="translate-x-full"
            >
              <DialogPanel className="h-full w-full max-w-2xl overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">Audit Details</h2>
                    <p className="text-sm text-slate-500">
                      {log?.module} • {log?.action} • {log?.entity_type} #{log?.entity_id}
                    </p>
                  </div>
                  <Button type="button" variant="outline" onClick={onClose}>
                    Close
                  </Button>
                </div>

                {!log ? null : (
                  <div className="mt-6 space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-[hsl(var(--muted-bg))] p-4 text-sm dark:border-slate-800">
                      <p>{new Date(log.timestamp).toLocaleString()}</p>
                      <p className="mt-1 text-slate-600">{log.user_name || "Unknown user"}</p>
                      {log.summary ? <p className="mt-3 font-medium text-slate-900">{log.summary}</p> : null}
                      {log.reason ? <p className="mt-1 text-slate-600">Reason: {log.reason}</p> : null}
                      {log.remarks ? <p className="mt-1 text-slate-600">Remarks: {log.remarks}</p> : null}
                      {log.source_screen ? (
                        <p className="mt-1 text-slate-600">
                          Source: {log.source_screen}
                          {log.source_reference ? ` • ${log.source_reference}` : ""}
                        </p>
                      ) : null}
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <pre className="max-h-96 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
                        {JSON.stringify(log.before_snapshot, null, 2)}
                      </pre>
                      <pre className="max-h-96 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
                        {JSON.stringify(log.after_snapshot, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
