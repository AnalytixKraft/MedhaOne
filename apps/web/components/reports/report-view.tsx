"use client";

import { useEffect, useMemo, useState } from "react";

import { PageTitle } from "@/components/layout/page-title";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  apiClient,
  DeadStockReportRow,
  ExpiryReportRow,
  PurchaseCreditNote,
  PurchaseRegisterReportRow,
  StockAgeingReportRow,
  StockInwardReportRow,
  StockMovementReportRow,
} from "@/lib/api/client";
import { formatQuantity } from "@/lib/quantity";

type ReportKind =
  | "purchase-credit-notes"
  | "stock-inward"
  | "purchase-register"
  | "stock-movement"
  | "expiry"
  | "dead-stock"
  | "stock-ageing";

type Row =
  | PurchaseCreditNote
  | StockInwardReportRow
  | PurchaseRegisterReportRow
  | StockMovementReportRow
  | ExpiryReportRow
  | DeadStockReportRow
  | StockAgeingReportRow;

const reportMeta: Record<
  ReportKind,
  {
    title: string;
    description: string;
    columns: string[];
  }
> = {
  "purchase-credit-notes": {
    title: "Purchase Credit Notes",
    description: "Informational supplier credit notes generated from posted purchase returns.",
    columns: ["Credit Note", "Supplier", "Warehouse", "Return", "Amount", "Status", "Created"],
  },
  "stock-inward": {
    title: "Stock Inward Report",
    description: "Incoming stock posted through purchase GRNs.",
    columns: ["GRN", "PO", "Supplier", "Warehouse", "Product", "Batch", "Qty", "Date"],
  },
  "purchase-register": {
    title: "Purchase Register",
    description: "Purchase orders with ordered, received, pending and value totals.",
    columns: ["PO", "Supplier", "Warehouse", "Status", "Ordered", "Received", "Pending", "Value"],
  },
  "stock-movement": {
    title: "Stock Movement Report",
    description: "Immutable inventory ledger movement across all transaction reasons.",
    columns: ["Date", "Reason", "Reference", "Product", "Batch", "Warehouse", "In", "Out", "Balance"],
  },
  expiry: {
    title: "Expiry Report",
    description: "Current stock that is near expiry or already expired.",
    columns: ["Product", "Batch", "Warehouse", "Expiry", "Days", "Qty"],
  },
  "dead-stock": {
    title: "Dead Stock Report",
    description: "Products with no inventory movement beyond the inactivity threshold.",
    columns: ["Product", "Warehouse", "Qty", "Last Movement", "Days Idle"],
  },
  "stock-ageing": {
    title: "Stock Ageing Report",
    description: "Current stock bucketed by age using posted GRN receipt dates.",
    columns: ["Product", "Warehouse", "0-30", "31-60", "61-90", "90+", "Total"],
  },
};

export function ReportView({ kind }: { kind: ReportKind }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const meta = reportMeta[kind];

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (kind === "purchase-credit-notes") {
          const response = await apiClient.listPurchaseCreditNotes();
          if (cancelled) {
            return;
          }
          setRows(response);
          setTotal(response.length);
          return;
        }

        const response =
          kind === "stock-inward"
            ? await apiClient.getStockInwardReport()
            : kind === "purchase-register"
              ? await apiClient.getPurchaseRegisterReport()
              : kind === "stock-movement"
                ? await apiClient.getStockMovementReport()
                : kind === "expiry"
                  ? await apiClient.getExpiryReport()
                  : kind === "dead-stock"
                    ? await apiClient.getDeadStockReport()
                    : await apiClient.getStockAgeingReport();

        if (cancelled) {
          return;
        }

        setRows(response.data);
        setTotal(response.total);
      } catch (caught) {
        if (cancelled) {
          return;
        }
        setError(caught instanceof Error ? caught.message : "Failed to load report");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const renderedRows = useMemo(() => {
    if (kind === "purchase-credit-notes") {
      return (rows as PurchaseCreditNote[]).map((row) => (
        <TableRow key={row.id}>
          <TableCell className="font-medium">{row.credit_note_number}</TableCell>
          <TableCell>{row.supplier_id}</TableCell>
          <TableCell>{row.warehouse_id}</TableCell>
          <TableCell>{row.purchase_return_id}</TableCell>
          <TableCell>{row.total_amount}</TableCell>
          <TableCell>{row.status}</TableCell>
          <TableCell>{new Date(row.created_at).toLocaleString()}</TableCell>
        </TableRow>
      ));
    }

    if (kind === "stock-inward") {
      return (rows as StockInwardReportRow[]).map((row) => (
        <TableRow key={`${row.grn_number}-${row.batch_no}-${row.product_name}`}>
          <TableCell className="font-medium">{row.grn_number}</TableCell>
          <TableCell>{row.po_number}</TableCell>
          <TableCell>{row.supplier_name}</TableCell>
          <TableCell>{row.warehouse_name}</TableCell>
          <TableCell>{row.product_name}</TableCell>
          <TableCell>{row.batch_no}</TableCell>
          <TableCell>{formatQuantity(row.qty_received, row.quantity_precision)}</TableCell>
          <TableCell>{row.received_date}</TableCell>
        </TableRow>
      ));
    }

    if (kind === "purchase-register") {
      return (rows as PurchaseRegisterReportRow[]).map((row) => (
        <TableRow key={row.po_number}>
          <TableCell className="font-medium">{row.po_number}</TableCell>
          <TableCell>{row.supplier}</TableCell>
          <TableCell>{row.warehouse}</TableCell>
          <TableCell>{row.status}</TableCell>
          <TableCell>{row.total_order_qty}</TableCell>
          <TableCell>{row.total_received_qty}</TableCell>
          <TableCell>{row.pending_qty}</TableCell>
          <TableCell>{row.total_value ?? "-"}</TableCell>
        </TableRow>
      ));
    }

    if (kind === "expiry") {
      return (rows as ExpiryReportRow[]).map((row) => (
        <TableRow key={`${row.product}-${row.batch}-${row.warehouse}`}>
          <TableCell className="font-medium">{row.product}</TableCell>
          <TableCell>{row.batch}</TableCell>
          <TableCell>{row.warehouse}</TableCell>
          <TableCell>{row.expiry_date}</TableCell>
          <TableCell>{row.days_to_expiry}</TableCell>
          <TableCell>{formatQuantity(row.current_qty, row.quantity_precision)}</TableCell>
        </TableRow>
      ));
    }

    if (kind === "dead-stock") {
      return (rows as DeadStockReportRow[]).map((row) => (
        <TableRow key={`${row.product}-${row.warehouse}`}>
          <TableCell className="font-medium">{row.product}</TableCell>
          <TableCell>{row.warehouse}</TableCell>
          <TableCell>{formatQuantity(row.current_qty, row.quantity_precision)}</TableCell>
          <TableCell>
            {row.last_movement_date ? new Date(row.last_movement_date).toLocaleString() : "-"}
          </TableCell>
          <TableCell>{row.days_since_movement ?? "-"}</TableCell>
        </TableRow>
      ));
    }

    if (kind === "stock-ageing") {
      return (rows as StockAgeingReportRow[]).map((row) => (
        <TableRow key={`${row.product}-${row.warehouse}`}>
          <TableCell className="font-medium">{row.product}</TableCell>
          <TableCell>{row.warehouse}</TableCell>
          <TableCell>{formatQuantity(row.bucket_0_30, row.quantity_precision)}</TableCell>
          <TableCell>{formatQuantity(row.bucket_31_60, row.quantity_precision)}</TableCell>
          <TableCell>{formatQuantity(row.bucket_61_90, row.quantity_precision)}</TableCell>
          <TableCell>{formatQuantity(row.bucket_90_plus, row.quantity_precision)}</TableCell>
          <TableCell>{formatQuantity(row.total_qty, row.quantity_precision)}</TableCell>
        </TableRow>
      ));
    }

    return (rows as StockMovementReportRow[]).map((row) => (
      <TableRow key={`${row.transaction_date}-${row.reference_id}-${row.batch}`}>
        <TableCell className="font-medium">{new Date(row.transaction_date).toLocaleString()}</TableCell>
        <TableCell>{row.reason}</TableCell>
        <TableCell>{row.reference_type ? `${row.reference_type} ${row.reference_id ?? ""}`.trim() : "-"}</TableCell>
        <TableCell>{row.product}</TableCell>
        <TableCell>{row.batch}</TableCell>
        <TableCell>{row.warehouse}</TableCell>
        <TableCell>{formatQuantity(row.qty_in, row.quantity_precision)}</TableCell>
        <TableCell>{formatQuantity(row.qty_out, row.quantity_precision)}</TableCell>
        <TableCell>{formatQuantity(row.running_balance, row.quantity_precision)}</TableCell>
      </TableRow>
    ));
  }, [kind, rows]);

  return (
    <div className="space-y-6">
      <PageTitle title={meta.title} description={meta.description} />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Rows</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{total} records available.</p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              window.location.reload();
            }}
          >
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
          {loading ? <p className="text-sm text-muted-foreground">Loading report...</p> : null}
          {!loading && !error && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No report rows found.</p>
          ) : null}
          {!loading && !error && rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  {meta.columns.map((column) => (
                    <TableHead key={column}>{column}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>{renderedRows}</TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
