"use client";

import { useCallback, useEffect, useState } from "react";

import { usePermissions } from "@/components/auth/permission-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Grn, apiClient } from "@/lib/api/client";

type GrnDetailProps = {
  grnId: number;
};

export function GrnDetail({ grnId }: GrnDetailProps) {
  const { hasPermission } = usePermissions();
  const [grn, setGrn] = useState<Grn | null>(null);
  const [stockQty, setStockQty] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getGrn(grnId);
      setGrn(data);
      if (data.status === "POSTED" && data.lines.length > 0) {
        const firstLine = data.lines[0];
        try {
          const summary = await apiClient.getTestStockSummary({
            warehouse_id: data.warehouse_id,
            product_id: firstLine.product_id,
            batch_id: firstLine.batch_id,
          });
          setStockQty(summary.qty_on_hand);
        } catch {
          setStockQty(null);
        }
      } else {
        setStockQty(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load GRN");
    } finally {
      setLoading(false);
    }
  }, [grnId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePost = async () => {
    setPosting(true);
    setError(null);
    try {
      await apiClient.postGrn(grnId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post GRN");
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading GRN...</p>;
  }

  if (!grn) {
    return <p className="text-sm text-red-500">GRN not found</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{grn.grn_number}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Status: <span data-testid="status-badge">{grn.status}</span>
          </p>
          <p>PO: {grn.purchase_order_id}</p>
          <p>Supplier: {grn.supplier_id}</p>
          <p>Warehouse: {grn.warehouse_id}</p>
          <p>Received Date: {grn.received_date}</p>
          {stockQty ? (
            <p>
              Stock Qty: <span data-testid="stock-qty">{stockQty}</span>
            </p>
          ) : null}
          {grn.status === "DRAFT" && hasPermission("grn:post") ? (
            <Button
              data-testid="post-grn"
              onClick={handlePost}
              disabled={posting}
            >
              {posting ? "Posting..." : "Post GRN"}
            </Button>
          ) : null}
          {error ? <p className="text-red-500">{error}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>GRN Lines</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO Line</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Free</TableHead>
                <TableHead>Expiry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grn.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{line.po_line_id}</TableCell>
                  <TableCell>{line.product_id}</TableCell>
                  <TableCell>{line.batch_id}</TableCell>
                  <TableCell>{line.received_qty}</TableCell>
                  <TableCell>{line.free_qty}</TableCell>
                  <TableCell>{line.expiry_date}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
