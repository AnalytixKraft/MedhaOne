"use client";

import { Dialog, DialogBackdrop, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { Trash2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";

import { usePermissions } from "@/components/auth/permission-provider";
import { AppSectionCard, AppTable } from "@/components/erp/app-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Warehouse,
  WarehouseBulkDeleteResult,
  WarehousePayload,
  apiClient,
} from "@/lib/api/client";

type FormState = {
  name: string;
  code: string;
  address: string;
  is_active: boolean;
};

type ConfirmationState = {
  ids: number[];
  title: string;
  description: string;
};

const initialState: FormState = {
  name: "",
  code: "",
  address: "",
  is_active: true,
};
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

const textareaClassName =
  "flex min-h-24 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function formatBulkDeleteMessage(result: WarehouseBulkDeleteResult): string {
  const parts: string[] = [];
  if (result.deleted_count > 0) {
    parts.push(`${result.deleted_count} deleted`);
  }
  if (result.deactivated_count > 0) {
    parts.push(`${result.deactivated_count} deactivated`);
  }
  if (result.failed_count > 0) {
    parts.push(`${result.failed_count} failed`);
  }
  return parts.length > 0 ? `Warehouse update complete: ${parts.join(", ")}.` : "No warehouses were changed.";
}

export function WarehousesManager() {
  const { user, hasPermission, loading: permissionsLoading } = usePermissions();
  const [items, setItems] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialState);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);

  const modeLabel = useMemo(
    () => (editingId ? "Update Warehouse" : "Add Warehouse"),
    [editingId],
  );
  const canManage = !!user && (user.is_superuser || hasPermission("masters:manage"));
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return items.slice(startIndex, startIndex + pageSize);
  }, [currentPage, items, pageSize]);
  const allVisibleSelected =
    paginatedItems.length > 0 && paginatedItems.every((item) => selectedIds.includes(item.id));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiClient.listWarehouses(true);
      setItems(data);
      setSelectedIds((current) => current.filter((id) => data.some((item) => item.id === id)));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load warehouses",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const resetForm = () => {
    setForm(initialState);
    setEditingId(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const payload: WarehousePayload = {
      name: form.name,
      code: form.code,
      address: form.address || undefined,
      is_active: form.is_active,
    };

    try {
      if (editingId) {
        await apiClient.updateWarehouse(editingId, payload);
        setSuccess("Warehouse updated successfully.");
      } else {
        await apiClient.createWarehouse(payload);
        setSuccess("Warehouse added successfully.");
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save warehouse");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (item: Warehouse) => {
    if (!canManage) {
      return;
    }
    setEditingId(item.id);
    setForm({
      name: item.name,
      code: item.code,
      address: item.address ?? "",
      is_active: item.is_active,
    });
    setError(null);
    setSuccess(null);
  };

  const openDeleteConfirmation = (ids: number[]) => {
    const targetCount = ids.length;
    setConfirmation({
      ids,
      title: targetCount === 1 ? "Delete warehouse?" : `Delete ${targetCount} warehouses?`,
      description:
        targetCount === 1
          ? "If the warehouse has transactions, it will be deactivated instead of deleted."
          : "Selected warehouses with transactions will be deactivated instead of deleted.",
    });
  };

  const handleDeleteConfirmed = async () => {
    if (!confirmation) {
      return;
    }

    setDeleting(true);
    setError(null);
    setSuccess(null);

    try {
      if (confirmation.ids.length === 1) {
        const result = await apiClient.deleteWarehouse(confirmation.ids[0]);
        setSuccess(result.message);
        if (editingId === confirmation.ids[0]) {
          resetForm();
        }
      } else {
        const result = await apiClient.bulkDeleteWarehouses(confirmation.ids);
        setSuccess(formatBulkDeleteMessage(result));
        if (editingId && confirmation.ids.includes(editingId)) {
          resetForm();
        }
        if (result.errors.length > 0) {
          setError(result.errors.map((entry) => entry.message).join(" "));
        }
      }
      setConfirmation(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete warehouses");
    } finally {
      setDeleting(false);
    }
  };

  const toggleSelection = (warehouseId: number, checked: boolean) => {
    setSelectedIds((current) =>
      checked ? [...current, warehouseId] : current.filter((id) => id !== warehouseId),
    );
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds((current) => {
      if (checked) {
        const next = new Set(current);
        for (const item of paginatedItems) {
          next.add(item.id);
        }
        return Array.from(next);
      }
      return current.filter((id) => !paginatedItems.some((item) => item.id === id));
    });
  };

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[360px,1fr]">
        <AppSectionCard
          title={modeLabel}
          description="Create and maintain warehouse master data in a simple operational form."
        >
          {!permissionsLoading && !canManage ? (
            <p className="text-sm text-muted-foreground">
              You have read-only access. Warehouse changes are disabled for your role.
            </p>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="text-sm font-medium text-[hsl(var(--text-primary))]">
                  Warehouse Name
                </label>
                <Input
                  data-testid="warehouse-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder="Warehouse Name"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-[hsl(var(--text-primary))]">
                  Warehouse Code
                </label>
                <Input
                  data-testid="warehouse-code"
                  value={form.code}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, code: event.target.value }))
                  }
                  placeholder="Warehouse Code"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-[hsl(var(--text-primary))]">
                  Address
                </label>
                <textarea
                  value={form.address}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, address: event.target.value }))
                  }
                  placeholder="Address"
                  className={textareaClassName}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-[hsl(var(--text-primary))]">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      is_active: event.target.checked,
                    }))
                  }
                />
                Active
              </label>

              <div className="flex flex-wrap gap-2">
                <Button
                  data-testid="create-warehouse"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? "Saving..." : modeLabel}
                </Button>
                {editingId ? (
                  <Button type="button" variant="outline" onClick={resetForm}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          )}
        </AppSectionCard>

        <AppTable
          title="Warehouses"
          description="Review warehouse records, edit existing entries, and remove or deactivate unused locations."
          actions={
            <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Rows</span>
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setCurrentPage(1);
                  }}
                  className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              {canManage ? (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={selectedIds.length === 0 || deleting}
                  onClick={() => openDeleteConfirmation(selectedIds)}
                  data-testid="delete-selected-warehouses"
                >
                  Delete Selected
                </Button>
              ) : null}
            </div>
          }
        >
          {error ? <p className="px-4 pb-3 pt-4 text-sm text-red-500">{error}</p> : null}
          {success ? <p className="px-4 pb-3 pt-4 text-sm text-emerald-600">{success}</p> : null}
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">
              Loading warehouses...
            </p>
          ) : (
            <Table>
              <TableHeader className="bg-[hsl(var(--table-header-bg))]">
                <TableRow>
                  <TableHead className="w-12">
                    <input
                      type="checkbox"
                      aria-label="Select all warehouses"
                      checked={allVisibleSelected}
                      onChange={(event) => toggleSelectAll(event.target.checked)}
                      disabled={!canManage || items.length === 0}
                    />
                  </TableHead>
                  <TableHead>Warehouse Name</TableHead>
                  <TableHead>Warehouse Code</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.name}`}
                        checked={selectedIds.includes(item.id)}
                        onChange={(event) => toggleSelection(item.id, event.target.checked)}
                        disabled={!canManage}
                      />
                    </TableCell>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>{item.code}</TableCell>
                    <TableCell>{item.address ?? "-"}</TableCell>
                    <TableCell>
                      <span className={item.is_active ? "text-emerald-700" : "text-amber-700"}>
                        {item.is_active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEdit(item)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-rose-600 hover:text-rose-700"
                            onClick={() => openDeleteConfirmation([item.id])}
                            aria-label={`Delete ${item.name}`}
                            data-testid={`delete-warehouse-${item.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">View only</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!loading && items.length > 0 ? (
            <div className="flex flex-col gap-3 border-t border-border px-4 py-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
              <span>
                Showing {(currentPage - 1) * pageSize + 1}
                {" - "}
                {Math.min(currentPage * pageSize, items.length)}
                {" of "}
                {items.length}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((current) => Math.max(1, current - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <span className="min-w-24 text-center">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((current) => Math.min(totalPages, current + 1))}
                  disabled={currentPage >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </AppTable>
      </div>

      <Transition appear show={confirmation !== null} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setConfirmation(null)}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-150"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <DialogBackdrop className="fixed inset-0 bg-slate-950/35 backdrop-blur-sm" />
          </TransitionChild>
          <div className="fixed inset-0 overflow-y-auto p-4">
            <div className="flex min-h-full items-center justify-center">
              <TransitionChild
                as={Fragment}
                enter="ease-out duration-150"
                enterFrom="opacity-0 translate-y-2"
                enterTo="opacity-100 translate-y-0"
                leave="ease-in duration-100"
                leaveFrom="opacity-100 translate-y-0"
                leaveTo="opacity-0 translate-y-2"
              >
                <DialogPanel className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-[hsl(var(--text-primary))]">
                      {confirmation?.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {confirmation?.description}
                    </p>
                  </div>
                  <div className="mt-6 flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setConfirmation(null)}
                      disabled={deleting}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => void handleDeleteConfirmed()}
                      disabled={deleting}
                    >
                      {deleting ? "Deleting..." : "Confirm Delete"}
                    </Button>
                  </div>
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}
