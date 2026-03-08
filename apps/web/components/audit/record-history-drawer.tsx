"use client";

import { Dialog, DialogBackdrop, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { apiClient, type RecordHistoryResponse } from "@/lib/api/client";

type RecordHistoryDrawerProps = {
  open: boolean;
  onClose: () => void;
  entityType: string;
  entityId: number | null;
  title: string;
};

function JsonBlock({ value }: { value: Record<string, unknown> | null }) {
  if (!value) {
    return <p className="text-sm text-muted-foreground">No snapshot recorded.</p>;
  }

  return (
    <pre className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function RecordHistoryDrawer({
  open,
  onClose,
  entityType,
  entityId,
  title,
}: RecordHistoryDrawerProps) {
  const [history, setHistory] = useState<RecordHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || entityId === null) {
      return;
    }
    const currentEntityId = entityId;

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiClient.getRecordHistory(entityType, currentEntityId);
        if (!cancelled) {
          setHistory(response);
        }
      } catch (caught) {
        if (!cancelled) {
          setHistory(null);
          setError(caught instanceof Error ? caught.message : "Failed to load record history.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [entityId, entityType, open]);

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
                    <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
                    <p className="text-sm text-slate-500">
                      {entityType} #{entityId ?? "-"}
                    </p>
                  </div>
                  <Button type="button" variant="outline" onClick={onClose}>
                    Close
                  </Button>
                </div>

                <div className="mt-6 space-y-4">
                  {loading ? <p className="text-sm text-muted-foreground">Loading history...</p> : null}
                  {error ? <p className="text-sm text-rose-600">{error}</p> : null}
                  {!loading && !error && history?.entries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No history found for this record.</p>
                  ) : null}

                  {history?.entries.map((entry) => (
                    <div key={entry.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                        <span>{entry.action}</span>
                        <span>{entry.module}</span>
                        <span>{new Date(entry.timestamp).toLocaleString()}</span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-900">
                        {entry.summary || `${entry.action} ${entry.entity_type}`}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {entry.user_name || "Unknown user"}
                        {entry.reason ? ` • Reason: ${entry.reason}` : ""}
                      </p>
                      {entry.remarks ? (
                        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                          {entry.remarks}
                        </p>
                      ) : null}
                      {entry.changed_fields.length > 0 ? (
                        <p className="mt-2 text-xs text-slate-500">
                          Changed: {entry.changed_fields.join(", ")}
                        </p>
                      ) : null}
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                            Before
                          </p>
                          <JsonBlock value={entry.before_snapshot} />
                        </div>
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                            After
                          </p>
                          <JsonBlock value={entry.after_snapshot} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
