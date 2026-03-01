"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
  Grn,
  GrnLinePayload,
  PurchaseOrder,
  apiClient,
} from "@/lib/api/client";

type LineDraft = {
  received_qty: string;
  free_qty: string;
  batch_no: string;
  expiry_date: string;
};

export function GrnManager() {
  const { hasPermission, loading: permissionLoading } = usePermissions();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [grns, setGrns] = useState<Grn[]>([]);
  const [selectedPoId, setSelectedPoId] = useState("");
  const [lineDrafts, setLineDrafts] = useState<Record<number, LineDraft>>({});
  const [receivedDate, setReceivedDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const [poRes, grnRes] = await Promise.all([
        apiClient.listPurchaseOrders(),
        apiClient.listGrns(),
      ]);
      setPurchaseOrders(poRes.items);
      setGrns(grnRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load GRN data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const availablePos = useMemo(
    () =>
      purchaseOrders.filter(
        (po) => po.status === "APPROVED" || po.status === "PARTIALLY_RECEIVED",
      ),
    [purchaseOrders],
  );

  const selectedPo = useMemo(
    () => availablePos.find((po) => String(po.id) === selectedPoId) ?? null,
    [availablePos, selectedPoId],
  );

  useEffect(() => {
    if (!selectedPo) {
      setLineDrafts({});
      return;
    }

    const nextDrafts: Record<number, LineDraft> = {};
    for (const line of selectedPo.lines) {
      const remaining = Math.max(
        Number(line.ordered_qty) - Number(line.received_qty),
        0,
      );
      nextDrafts[line.id] = {
        received_qty: remaining > 0 ? remaining.toString() : "0",
        free_qty: "0",
        batch_no: "",
        expiry_date: "",
      };
    }
    setLineDrafts(nextDrafts);
  }, [selectedPo]);

  const updateLine = (poLineId: number, patch: Partial<LineDraft>) => {
    setLineDrafts((prev) => ({
      ...prev,
      [poLineId]: {
        ...prev[poLineId],
        ...patch,
      },
    }));
  };

  const handleCreateGrn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPo) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const lines: GrnLinePayload[] = [];
      for (const line of selectedPo.lines) {
        const draft = lineDrafts[line.id];
        if (!draft || Number(draft.received_qty) <= 0) {
          continue;
        }
        if (!draft.batch_no || !draft.expiry_date) {
          throw new Error(
            "Batch no and expiry are required for received lines",
          );
        }

        lines.push({
          po_line_id: line.id,
          received_qty: draft.received_qty,
          free_qty: draft.free_qty || "0",
          batch_no: draft.batch_no,
          expiry_date: draft.expiry_date,
        });
      }

      if (lines.length === 0) {
        throw new Error("Enter at least one received line quantity");
      }

      await apiClient.createGrnFromPo(selectedPo.id, {
        received_date: receivedDate,
        lines,
      });

      setSelectedPoId("");
      setLineDrafts({});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create GRN");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[460px,1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Create GRN From PO</CardTitle>
        </CardHeader>
        <CardContent>
          {permissionLoading ? (
            <p className="text-sm text-muted-foreground">Loading permissions...</p>
          ) : hasPermission("grn:create") ? (
            <form className="space-y-3" onSubmit={handleCreateGrn}>
            <select
              data-testid="grn-po-select"
              value={selectedPoId}
              onChange={(event) => setSelectedPoId(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              required
            >
              <option value="">Select approved PO</option>
              {availablePos.map((po) => (
                <option key={po.id} value={po.id}>
                  {po.po_number} ({po.status})
                </option>
              ))}
            </select>

            <Input
              type="date"
              value={receivedDate}
              onChange={(event) => setReceivedDate(event.target.value)}
              required
            />

            {selectedPo ? (
              <div className="space-y-2">
                {selectedPo.lines.map((line) => {
                  const draft = lineDrafts[line.id];
                  const remaining = Math.max(
                    Number(line.ordered_qty) - Number(line.received_qty),
                    0,
                  );

                  return (
                    <div
                      key={line.id}
                      className="space-y-2 rounded-md border p-2"
                    >
                      <p className="text-xs text-muted-foreground">
                        PO Line #{line.id} | Remaining: {remaining}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          data-testid={`grn-line-qty-${line.id}`}
                          value={draft?.received_qty ?? "0"}
                          onChange={(event) =>
                            updateLine(line.id, {
                              received_qty: event.target.value,
                            })
                          }
                          placeholder="Received qty"
                          type="number"
                          step="0.001"
                        />
                        <Input
                          value={draft?.free_qty ?? "0"}
                          onChange={(event) =>
                            updateLine(line.id, {
                              free_qty: event.target.value,
                            })
                          }
                          placeholder="Free qty"
                          type="number"
                          step="0.001"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          data-testid={`grn-line-batch-${line.id}`}
                          value={draft?.batch_no ?? ""}
                          onChange={(event) =>
                            updateLine(line.id, {
                              batch_no: event.target.value,
                            })
                          }
                          placeholder="Batch no"
                        />
                        <Input
                          data-testid={`grn-line-expiry-${line.id}`}
                          value={draft?.expiry_date ?? ""}
                          onChange={(event) =>
                            updateLine(line.id, {
                              expiry_date: event.target.value,
                            })
                          }
                          type="date"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <Button
              data-testid="create-grn-from-po"
              type="submit"
              disabled={saving || !selectedPo}
            >
              {saving ? "Saving..." : "Create GRN"}
            </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              You do not have permission to create GRNs.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>GRNs</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? <p className="mb-3 text-sm text-red-500">{error}</p> : null}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading GRNs...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>GRN No</TableHead>
                  <TableHead>PO</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Received Date</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grns.map((grn) => (
                  <TableRow key={grn.id} data-testid="grn-row">
                    <TableCell data-testid="grn-number">
                      {grn.grn_number}
                    </TableCell>
                    <TableCell>{grn.purchase_order_id}</TableCell>
                    <TableCell>
                      <span data-testid="status-badge">{grn.status}</span>
                    </TableCell>
                    <TableCell>{grn.received_date}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/purchase/grn/${grn.id}`}>View</Link>
                      </Button>
                    </TableCell>
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
