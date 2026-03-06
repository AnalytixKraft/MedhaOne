"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Trash2 } from "lucide-react";

import { usePermissions } from "@/components/auth/permission-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  apiClient,
  type BulkImportError,
  type Party,
  type PartyPayload,
  type PartyType,
} from "@/lib/api/client";
import {
  extractPanFromGstin,
  extractStateFromGstin,
  GSTIN_PATTERN,
  normalizeGstin,
} from "@/lib/gst";
import { cn } from "@/lib/utils";

const partyTypes: PartyType[] = [
  "MANUFACTURER",
  "SUPER_STOCKIST",
  "DISTRIBUTOR",
  "HOSPITAL",
  "PHARMACY",
  "RETAILER",
  "CONSUMER",
];

type GridField =
  | "name"
  | "party_type"
  | "phone"
  | "email"
  | "gstin"
  | "pan_number"
  | "state"
  | "city"
  | "pincode"
  | "is_active";

type DraftPartyRow = {
  id: string;
  name: string;
  party_type: PartyType;
  phone: string;
  email: string;
  gstin: string;
  pan_number: string;
  state: string;
  state_overridden: boolean;
  city: string;
  pincode: string;
  is_active: boolean;
};

type RowErrors = Partial<Record<GridField, string>>;

function createEmptyRow(id: number): DraftPartyRow {
  return {
    id: `party-row-${id}`,
    name: "",
    party_type: "DISTRIBUTOR",
    phone: "",
    email: "",
    gstin: "",
    pan_number: "",
    state: "",
    state_overridden: false,
    city: "",
    pincode: "",
    is_active: true,
  };
}

function isRowBlank(row: DraftPartyRow): boolean {
  return !(
    row.name.trim() ||
    row.phone.trim() ||
    row.email.trim() ||
    row.gstin.trim() ||
    row.pan_number.trim() ||
    row.state.trim() ||
    row.city.trim() ||
    row.pincode.trim()
  );
}

function validateRow(row: DraftPartyRow): RowErrors {
  const errors: RowErrors = {};
  if (!row.name.trim()) {
    errors.name = "Name is required";
  }
  if (row.phone.trim() && !/^\d+$/.test(row.phone.trim())) {
    errors.phone = "Phone must be numeric";
  }
  if (row.gstin.trim() && !GSTIN_PATTERN.test(row.gstin.trim())) {
    errors.gstin = "Invalid GSTIN format";
  }
  if (row.pincode.trim() && !/^\d{6}$/.test(row.pincode.trim())) {
    errors.pincode = "PIN must be 6 digits";
  }
  return errors;
}

export function PartiesManager() {
  const { user, hasPermission, loading: permissionsLoading } = usePermissions();
  const [items, setItems] = useState<Party[]>([]);
  const [rows, setRows] = useState<DraftPartyRow[]>([createEmptyRow(1)]);
  const [rowErrors, setRowErrors] = useState<Record<string, RowErrors>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const nextRowId = useRef(2);
  const cellRefs = useRef<Record<string, HTMLElement | null>>({});
  const pendingFocus = useRef<{ rowId: string; field: GridField } | null>(null);

  const canManage = !!user && (user.is_superuser || hasPermission("masters:manage"));

  const registerCell = useCallback(
    (rowId: string, field: GridField, element: HTMLElement | null) => {
      cellRefs.current[`${rowId}:${field}`] = element;
    },
    [],
  );

  const focusCell = useCallback((rowId: string, field: GridField) => {
    cellRefs.current[`${rowId}:${field}`]?.focus();
  }, []);

  useEffect(() => {
    if (!pendingFocus.current) {
      return;
    }
    const target = pendingFocus.current;
    pendingFocus.current = null;
    focusCell(target.rowId, target.field);
  }, [focusCell, rows]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.listParties();
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load parties");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const insertRowAfter = useCallback((afterRowId?: string) => {
    const newRow = createEmptyRow(nextRowId.current++);
    setRows((current) => {
      if (!afterRowId) {
        return [...current, newRow];
      }
      const index = current.findIndex((row) => row.id === afterRowId);
      if (index < 0) {
        return [...current, newRow];
      }
      const next = [...current];
      next.splice(index + 1, 0, newRow);
      return next;
    });
    pendingFocus.current = { rowId: newRow.id, field: "name" };
  }, []);

  const updateRow = useCallback((rowId: string, patch: Partial<DraftPartyRow>) => {
    setRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
    setRowErrors((current) => {
      if (!current[rowId]) {
        return current;
      }
      const next = { ...current };
      next[rowId] = {};
      return next;
    });
  }, []);

  const handleGstinChange = useCallback((rowId: string, rawValue: string) => {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) {
          return row;
        }

        const gstin = normalizeGstin(rawValue);
        if (!gstin) {
          return {
            ...row,
            gstin: "",
            state_overridden: false,
          };
        }

        if (!GSTIN_PATTERN.test(gstin)) {
          return {
            ...row,
            gstin,
            pan_number: "",
            ...(row.state_overridden ? {} : { state: "" }),
          };
        }

        const derivedState = extractStateFromGstin(gstin);
        return {
          ...row,
          gstin,
          pan_number: extractPanFromGstin(gstin),
          ...(row.state_overridden ? {} : { state: derivedState }),
        };
      }),
    );
    setRowErrors((current) => {
      if (!current[rowId]) {
        return current;
      }
      const next = { ...current };
      next[rowId] = {};
      return next;
    });
  }, []);

  const removeRow = useCallback((rowId: string) => {
    setRows((current) => {
      if (current.length <= 1) {
        return [createEmptyRow(nextRowId.current++)];
      }
      return current.filter((row) => row.id !== rowId);
    });
    setRowErrors((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
  }, []);

  const duplicateRow = useCallback((source: DraftPartyRow) => {
    const clone: DraftPartyRow = {
      ...source,
      id: `party-row-${nextRowId.current++}`,
    };
    setRows((current) => {
      const index = current.findIndex((row) => row.id === source.id);
      if (index < 0) {
        return [...current, clone];
      }
      const next = [...current];
      next.splice(index + 1, 0, clone);
      return next;
    });
    pendingFocus.current = { rowId: clone.id, field: "name" };
  }, []);

  const cancelRow = useCallback((rowId: string) => {
    setRows((current) => {
      if (current.length <= 1) {
        return [createEmptyRow(nextRowId.current++)];
      }
      return current.filter((row) => row.id !== rowId);
    });
    setRowErrors((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
  }, []);

  const mapErrorsToRows = useCallback(
    (
      errors: BulkImportError[],
      payloadToRowId: string[],
    ): Record<string, RowErrors> => {
      const nextErrors: Record<string, RowErrors> = {};
      for (const entry of errors) {
        const payloadIndex = entry.row - 1;
        const rowId = payloadToRowId[payloadIndex];
        if (!rowId) {
          continue;
        }
        if (!nextErrors[rowId]) {
          nextErrors[rowId] = {};
        }
        if (entry.field && entry.field in createEmptyRow(0)) {
          nextErrors[rowId][entry.field as GridField] = entry.message;
        } else if (!nextErrors[rowId].name) {
          nextErrors[rowId].name = entry.message;
        }
      }
      return nextErrors;
    },
    [],
  );

  const saveAll = useCallback(async () => {
    if (!canManage) {
      return;
    }

    setSaving(true);
    setError(null);
    setSummary(null);

    const candidateRows = rows.filter((row) => !isRowBlank(row));
    if (candidateRows.length === 0) {
      setSaving(false);
      setError("Add at least one party row to save.");
      return;
    }

    const validationErrors: Record<string, RowErrors> = {};
    const validRows: DraftPartyRow[] = [];

    for (const row of candidateRows) {
      const errors = validateRow(row);
      if (Object.keys(errors).length > 0) {
        validationErrors[row.id] = errors;
      } else {
        validRows.push(row);
      }
    }

    if (Object.keys(validationErrors).length > 0) {
      setRowErrors(validationErrors);
      setSaving(false);
      setError("Resolve inline validation errors before saving.");
      return;
    }

    const payloadRows: PartyPayload[] = validRows.map((row) => ({
      name: row.name.trim(),
      party_type: row.party_type,
      phone: row.phone.trim() || undefined,
      email: row.email.trim() || undefined,
      gstin: row.gstin.trim() || undefined,
      pan_number: row.gstin.trim() ? undefined : row.pan_number.trim() || undefined,
      state: row.state.trim() || undefined,
      city: row.city.trim() || undefined,
      pincode: row.pincode.trim() || undefined,
      is_active: row.is_active,
    }));

    try {
      const result = await apiClient.bulkCreateParties({ rows: payloadRows });
      const payloadToRowId = validRows.map((row) => row.id);
      const nextErrors = mapErrorsToRows(result.errors, payloadToRowId);
      setRowErrors(nextErrors);

      if (result.created_count > 0) {
        await load();
      }

      if (result.failed_count > 0) {
        const failedRowIds = new Set(
          result.errors
            .map((entry) => payloadToRowId[entry.row - 1])
            .filter((rowId): rowId is string => Boolean(rowId)),
        );
        const failedRows = validRows.filter((row) => failedRowIds.has(row.id));
        setRows(
          failedRows.length > 0
            ? [...failedRows, createEmptyRow(nextRowId.current++)]
            : [createEmptyRow(nextRowId.current++)],
        );
        setSummary(
          `Created ${result.created_count}, failed ${result.failed_count}.`,
        );
      } else {
        setRows([createEmptyRow(nextRowId.current++)]);
        setSummary(`Created ${result.created_count} parties successfully.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save parties.");
    } finally {
      setSaving(false);
    }
  }, [canManage, load, mapErrorsToRows, rows]);

  const handleCellKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>, rowId: string) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void saveAll();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        insertRowAfter(rowId);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        cancelRow(rowId);
      }
    },
    [cancelRow, insertRowAfter, saveAll],
  );

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-[#0b1f4b] to-[#133b7a] text-white">
          <CardTitle>Party Entry Grid</CardTitle>
          <p className="text-sm text-slate-200">
            Tab/Shift+Tab navigate, Enter adds row, Ctrl+Enter saves all, Esc cancels row.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 p-0">
          {error ? (
            <div className="mx-4 mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {error}
            </div>
          ) : null}
          {summary ? (
            <div className="mx-4 mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {summary}
            </div>
          ) : null}

          {!permissionsLoading && !canManage ? (
            <div className="px-4 pb-4 text-sm text-muted-foreground">
              You have read-only access. Master data changes are disabled for your role.
            </div>
          ) : (
            <>
              <div className="max-h-[520px] overflow-auto">
                <table className="min-w-[1550px] border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-[#0b1f4b] text-slate-100">
                    <tr>
                      {[
                        "#",
                        "Party Name",
                        "Type",
                        "Phone",
                        "Email",
                        "GSTIN",
                        "PAN",
                        "State",
                        "City",
                        "PIN Code",
                        "Status",
                        "Action",
                      ].map((header) => (
                        <th
                          key={header}
                          className="border-b border-slate-300/40 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em]"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => {
                      const errors = rowErrors[row.id] ?? {};
                      return (
                        <tr
                          key={row.id}
                          className={cn(
                            "border-b border-slate-200 align-top",
                            index % 2 === 0 ? "bg-white" : "bg-slate-50",
                            "hover:bg-sky-50",
                          )}
                        >
                          <td className="px-3 py-2 font-medium text-slate-600">{index + 1}</td>
                          <td className="px-3 py-2">
                            <Input
                              ref={(element) => registerCell(row.id, "name", element)}
                              value={row.name}
                              onChange={(event) =>
                                updateRow(row.id, { name: event.target.value })
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className={cn("h-9", errors.name && "border-rose-500")}
                            />
                            {errors.name ? (
                              <p className="mt-1 text-xs text-rose-600">{errors.name}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              ref={(element) => registerCell(row.id, "party_type", element)}
                              value={row.party_type}
                              onChange={(event) =>
                                updateRow(row.id, {
                                  party_type: event.target.value as PartyType,
                                })
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                            >
                              {partyTypes.map((type) => (
                                <option key={type} value={type}>
                                  {type}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              ref={(element) => registerCell(row.id, "phone", element)}
                              value={row.phone}
                              onChange={(event) =>
                                updateRow(row.id, {
                                  phone: event.target.value.replace(/[^\d]/g, ""),
                                })
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className={cn("h-9", errors.phone && "border-rose-500")}
                            />
                            {errors.phone ? (
                              <p className="mt-1 text-xs text-rose-600">{errors.phone}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              ref={(element) => registerCell(row.id, "email", element)}
                              type="email"
                              value={row.email}
                              onChange={(event) =>
                                updateRow(row.id, { email: event.target.value })
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className="h-9"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              ref={(element) => registerCell(row.id, "gstin", element)}
                              value={row.gstin}
                              onChange={(event) =>
                                handleGstinChange(row.id, event.target.value)
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className={cn("h-9 uppercase", errors.gstin && "border-rose-500")}
                            />
                            {errors.gstin ? (
                              <p className="mt-1 text-xs text-rose-600">{errors.gstin}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              ref={(element) => registerCell(row.id, "pan_number", element)}
                              value={row.pan_number}
                              onChange={(event) =>
                                updateRow(row.id, {
                                  pan_number: event.target.value.toUpperCase().slice(0, 10),
                                })
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              disabled={Boolean(row.gstin)}
                              className="h-9 uppercase"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              ref={(element) => registerCell(row.id, "state", element)}
                              value={row.state}
                              onChange={(event) => {
                                const nextState = event.target.value;
                                updateRow(row.id, {
                                  state: nextState,
                                  state_overridden: Boolean(nextState.trim()),
                                });
                              }}
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className="h-9"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              ref={(element) => registerCell(row.id, "city", element)}
                              value={row.city}
                              onChange={(event) =>
                                updateRow(row.id, { city: event.target.value })
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className="h-9"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              ref={(element) => registerCell(row.id, "pincode", element)}
                              value={row.pincode}
                              onChange={(event) =>
                                updateRow(row.id, {
                                  pincode: event.target.value.replace(/[^\d]/g, "").slice(0, 6),
                                })
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className={cn("h-9", errors.pincode && "border-rose-500")}
                            />
                            {errors.pincode ? (
                              <p className="mt-1 text-xs text-rose-600">{errors.pincode}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              ref={(element) => registerCell(row.id, "is_active", element)}
                              value={row.is_active ? "ACTIVE" : "INACTIVE"}
                              onChange={(event) =>
                                updateRow(row.id, {
                                  is_active: event.target.value === "ACTIVE",
                                })
                              }
                              onKeyDown={(event) => handleCellKeyDown(event, row.id)}
                              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                            >
                              <option value="ACTIVE">Active</option>
                              <option value="INACTIVE">Inactive</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => duplicateRow(row)}
                                aria-label={`Duplicate row ${index + 1}`}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-rose-500 hover:text-rose-600"
                                onClick={() => removeRow(row.id)}
                                aria-label={`Delete row ${index + 1}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between px-4 pb-4">
                <Button type="button" variant="outline" onClick={() => insertRowAfter()}>
                  Add Row
                </Button>
                <Button
                  data-testid="create-party"
                  type="button"
                  onClick={() => void saveAll()}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save All Rows (Ctrl+Enter)"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved Parties</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading parties...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>PAN</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>PIN</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>{item.party_type}</TableCell>
                    <TableCell>{item.gstin ?? "-"}</TableCell>
                    <TableCell>{item.pan_number ?? "-"}</TableCell>
                    <TableCell>{item.state ?? "-"}</TableCell>
                    <TableCell>{item.city ?? "-"}</TableCell>
                    <TableCell>{item.pincode ?? "-"}</TableCell>
                    <TableCell>{item.is_active ? "Active" : "Inactive"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
