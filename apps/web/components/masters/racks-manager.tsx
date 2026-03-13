"use client";

import { Save, SquarePen, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { usePermissions } from "@/components/auth/permission-provider";
import { AppTable } from "@/components/erp/app-primitives";
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
import { apiClient, type Rack, type RackPayload, type Warehouse } from "@/lib/api/client";

type RackFormState = {
  warehouse_id: string;
  rack_number: string;
  description: string;
  is_active: boolean;
};

const initialState: RackFormState = {
  warehouse_id: "",
  rack_number: "",
  description: "",
  is_active: true,
};

function toRackPayload(form: RackFormState): RackPayload {
  return {
    warehouse_id: Number(form.warehouse_id),
    rack_number: form.rack_number.trim(),
    description: form.description.trim() || undefined,
    is_active: form.is_active,
  };
}

export function RacksManager() {
  const { user, hasPermission, loading: permissionsLoading } = usePermissions();
  const canManage = !!user && (user.is_superuser || hasPermission("masters:manage"));

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [form, setForm] = useState<RackFormState>(initialState);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const warehouseOptions = useMemo(
    () =>
      [...warehouses]
        .filter((warehouse) => warehouse.is_active)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [warehouses],
  );

  const filteredRacks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return [...racks]
      .filter((rack) => {
        if (warehouseFilter && String(rack.warehouse_id) !== warehouseFilter) {
          return false;
        }
        if (!query) {
          return true;
        }
        return [rack.warehouse_name ?? "", rack.rack_number, rack.description ?? ""].some((value) =>
          value.toLowerCase().includes(query),
        );
      })
      .sort((left, right) => {
        const warehouseOrder = (left.warehouse_name ?? "").localeCompare(right.warehouse_name ?? "");
        if (warehouseOrder !== 0) {
          return warehouseOrder;
        }
        return left.rack_number.localeCompare(right.rack_number);
      });
  }, [racks, searchQuery, warehouseFilter]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [warehouseData, rackData] = await Promise.all([
        apiClient.listWarehouses(true),
        apiClient.listRacks({ include_inactive: true }),
      ]);
      setWarehouses(warehouseData);
      setRacks(rackData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load rack numbers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function updateForm<K extends keyof RackFormState>(field: K, value: RackFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm(initialState);
    setEditingId(null);
  }

  async function saveRack() {
    if (!form.warehouse_id || !form.rack_number.trim()) {
      setError("Warehouse and rack number are required.");
      return;
    }

    setSaving(true);
    setError(null);
    setSummary(null);
    try {
      if (editingId === null) {
        await apiClient.createRack(toRackPayload(form));
        setSummary(`Created rack ${form.rack_number.trim()}.`);
      } else {
        await apiClient.updateRack(editingId, toRackPayload(form));
        setSummary(`Updated rack ${form.rack_number.trim()}.`);
      }
      resetForm();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save rack");
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(rack: Rack) {
    if (!canManage) {
      return;
    }
    setEditingId(rack.id);
    setForm({
      warehouse_id: String(rack.warehouse_id),
      rack_number: rack.rack_number,
      description: rack.description ?? "",
      is_active: rack.is_active,
    });
    setError(null);
    setSummary(null);
  }

  async function deactivateRack(rack: Rack) {
    if (!canManage) {
      return;
    }
    setSaving(true);
    setError(null);
    setSummary(null);
    try {
      await apiClient.deactivateRack(rack.id);
      if (editingId === rack.id) {
        resetForm();
      }
      setSummary(`Deactivated rack ${rack.rack_number}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to deactivate rack");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {summary ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{summary}</p> : null}

      <AppTable
        title="Rack Details"
        description="Manage warehouse-wise rack details in a single grid."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search rack or description"
              className="min-w-[240px]"
            />
            <select
              value={warehouseFilter}
              onChange={(event) => setWarehouseFilter(event.target.value)}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">All warehouses</option>
              {warehouseOptions.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading rack details...</p>
        ) : (
          <Table>
            <TableHeader className="bg-[hsl(var(--table-header-bg))]">
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Rack Number</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!permissionsLoading && canManage ? (
                <TableRow className="align-top bg-[hsl(var(--muted-bg))]/50">
                  <TableCell className="min-w-[140px]">
                    <div className="flex items-center gap-2">
                      <Button type="button" size="icon" onClick={() => void saveRack()} disabled={saving}>
                        <Save className="h-4 w-4" />
                      </Button>
                      <Button type="button" size="icon" variant="outline" onClick={resetForm} disabled={saving}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-[220px]">
                    <select
                      value={form.warehouse_id}
                      onChange={(event) => updateForm("warehouse_id", event.target.value)}
                      className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground"
                    >
                      <option value="">Select warehouse</option>
                      {warehouseOptions.map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>
                          {warehouse.name}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell className="min-w-[140px]">
                    <Input
                      value={form.rack_number}
                      onChange={(event) => updateForm("rack_number", event.target.value.toUpperCase())}
                      placeholder="A-01"
                    />
                  </TableCell>
                  <TableCell className="min-w-[260px]">
                    <Input
                      value={form.description}
                      onChange={(event) => updateForm("description", event.target.value)}
                      placeholder="Fast moving tablets aisle"
                    />
                  </TableCell>
                  <TableCell className="min-w-[140px]">
                    <select
                      value={form.is_active ? "ACTIVE" : "INACTIVE"}
                      onChange={(event) => updateForm("is_active", event.target.value === "ACTIVE")}
                      className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground"
                    >
                      <option value="ACTIVE">{editingId === null ? "Active" : "Update Active"}</option>
                      <option value="INACTIVE">Inactive</option>
                    </select>
                  </TableCell>
                </TableRow>
              ) : null}
              {filteredRacks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    No rack details found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredRacks.map((rack) => (
                  <TableRow key={rack.id}>
                    <TableCell className="min-w-[120px]">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => beginEdit(rack)}
                          disabled={!canManage}
                          aria-label="Edit rack"
                        >
                          <SquarePen className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => void deactivateRack(rack)}
                          disabled={!canManage || !rack.is_active || saving}
                          aria-label="Deactivate rack"
                          className={!rack.is_active ? "opacity-50" : undefined}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>{rack.warehouse_name ?? "-"}</TableCell>
                    <TableCell className="font-medium">{rack.rack_number}</TableCell>
                    <TableCell>{rack.description ?? "-"}</TableCell>
                    <TableCell>{rack.is_active ? "Active" : "Inactive"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </AppTable>
    </div>
  );
}
