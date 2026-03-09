"use client";

import { Dialog, DialogBackdrop, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import {
  AlertTriangle,
  Boxes,
  Download,
  FileSpreadsheet,
  PackageSearch,
  Printer,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Fragment } from "react";

import { AppTable, MetricCard } from "@/components/erp/app-primitives";
import { PageTitle } from "@/components/layout/page-title";
import {
  ReportFilterBar,
  defaultReportFilters,
  type ReportFilterState,
} from "@/components/reports/report-filter-bar";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ApiRequestError,
  apiClient,
  type CurrentStockReportRow,
  type CurrentStockSourceDetailResponse,
  type CurrentStockSummary,
  type DeadStockReportRow,
  type ExpiryReportRow,
  type OpeningStockReportRow,
  type OpeningStockSummary,
  type PurchaseCreditNote,
  type PurchaseRegisterReportRow,
  type ReportFilterOptions,
  type StockAgeingReportRow,
  type StockInwardReportRow,
  type StockMovementReportRow,
  type StockSourceTraceabilityReportRow,
} from "@/lib/api/client";
import { formatQuantity } from "@/lib/quantity";

type ReportKind =
  | "purchase-credit-notes"
  | "stock-inward"
  | "purchase-register"
  | "stock-movement"
  | "expiry"
  | "dead-stock"
  | "stock-ageing"
  | "current-stock"
  | "opening-stock"
  | "stock-source-traceability";

type Row =
  | PurchaseCreditNote
  | StockInwardReportRow
  | PurchaseRegisterReportRow
  | StockMovementReportRow
  | ExpiryReportRow
  | DeadStockReportRow
  | StockAgeingReportRow
  | CurrentStockReportRow
  | OpeningStockReportRow
  | StockSourceTraceabilityReportRow;

type ColumnDef = {
  key: string;
  label: string;
  defaultWidth?: number;
  render: (row: Row) => string | number;
};

type SortState = {
  key: string;
  direction: "asc" | "desc";
};

type MetricCardDef = {
  label: string;
  value: string | number;
  icon: typeof Boxes;
  accent: "primary" | "success" | "warning" | "danger";
};

const reportMeta: Record<
  ReportKind,
  {
    title: string;
    description: string;
  }
> = {
  "purchase-credit-notes": {
    title: "Purchase Credit Notes",
    description: "Informational supplier credit notes generated from posted purchase returns.",
  },
  "stock-inward": {
    title: "Stock Inward Report",
    description: "Incoming stock posted through purchase GRNs.",
  },
  "purchase-register": {
    title: "Purchase Register",
    description: "Purchase orders with ordered, received, pending and value totals.",
  },
  "stock-movement": {
    title: "Stock Movement Report",
    description: "Immutable inventory ledger movement across all transaction reasons.",
  },
  expiry: {
    title: "Expiry Report",
    description: "Current stock that is near expiry or already expired.",
  },
  "dead-stock": {
    title: "Dead Stock Report",
    description: "Products with no inventory movement beyond the inactivity threshold.",
  },
  "stock-ageing": {
    title: "Stock Ageing Report",
    description: "Current stock bucketed by age using posted GRN receipt dates.",
  },
  "current-stock": {
    title: "Current Stock",
    description: "Real-time inventory visibility by product, warehouse and batch.",
  },
  "opening-stock": {
    title: "Opening Stock",
    description: "Opening stock entries and their impact on current quantity.",
  },
  "stock-source-traceability": {
    title: "Stock Source Traceability",
    description: "Trace stock batches back to suppliers, purchase orders, bills, and GRNs.",
  },
};

function columnsForKind(kind: ReportKind): ColumnDef[] {
  if (kind === "purchase-credit-notes") {
    return [
      { key: "credit_note_number", label: "Credit Note", defaultWidth: 180, render: (row) => (row as PurchaseCreditNote).credit_note_number },
      { key: "supplier_id", label: "Supplier", defaultWidth: 120, render: (row) => (row as PurchaseCreditNote).supplier_id },
      { key: "warehouse_id", label: "Warehouse", defaultWidth: 120, render: (row) => (row as PurchaseCreditNote).warehouse_id },
      { key: "purchase_return_id", label: "Return", defaultWidth: 120, render: (row) => (row as PurchaseCreditNote).purchase_return_id },
      { key: "total_amount", label: "Amount", defaultWidth: 140, render: (row) => (row as PurchaseCreditNote).total_amount },
      { key: "status", label: "Status", defaultWidth: 140, render: (row) => (row as PurchaseCreditNote).status },
      { key: "created_at", label: "Created", defaultWidth: 200, render: (row) => new Date((row as PurchaseCreditNote).created_at).toLocaleString() },
    ];
  }

  if (kind === "stock-inward") {
    return [
      { key: "grn_number", label: "GRN", defaultWidth: 150, render: (row) => (row as StockInwardReportRow).grn_number },
      { key: "po_number", label: "PO", defaultWidth: 150, render: (row) => (row as StockInwardReportRow).po_number },
      { key: "supplier_name", label: "Supplier", defaultWidth: 180, render: (row) => (row as StockInwardReportRow).supplier_name },
      { key: "warehouse_name", label: "Warehouse", defaultWidth: 160, render: (row) => (row as StockInwardReportRow).warehouse_name },
      { key: "product_name", label: "Product", defaultWidth: 180, render: (row) => (row as StockInwardReportRow).product_name },
      { key: "batch_no", label: "Batch", defaultWidth: 140, render: (row) => (row as StockInwardReportRow).batch_no },
      { key: "qty_received", label: "Qty", defaultWidth: 120, render: (row) => formatQuantity((row as StockInwardReportRow).qty_received, (row as StockInwardReportRow).quantity_precision) },
      { key: "received_date", label: "Date", defaultWidth: 140, render: (row) => (row as StockInwardReportRow).received_date },
    ];
  }

  if (kind === "purchase-register") {
    return [
      { key: "po_number", label: "PO", defaultWidth: 150, render: (row) => (row as PurchaseRegisterReportRow).po_number },
      { key: "supplier", label: "Supplier", defaultWidth: 170, render: (row) => (row as PurchaseRegisterReportRow).supplier },
      { key: "warehouse", label: "Warehouse", defaultWidth: 160, render: (row) => (row as PurchaseRegisterReportRow).warehouse },
      { key: "status", label: "Status", defaultWidth: 140, render: (row) => (row as PurchaseRegisterReportRow).status },
      { key: "total_order_qty", label: "Ordered", defaultWidth: 120, render: (row) => (row as PurchaseRegisterReportRow).total_order_qty },
      { key: "total_received_qty", label: "Received", defaultWidth: 120, render: (row) => (row as PurchaseRegisterReportRow).total_received_qty },
      { key: "pending_qty", label: "Pending", defaultWidth: 120, render: (row) => (row as PurchaseRegisterReportRow).pending_qty },
      { key: "total_value", label: "Value", defaultWidth: 140, render: (row) => (row as PurchaseRegisterReportRow).total_value ?? "-" },
    ];
  }

  if (kind === "stock-movement") {
    return [
      { key: "transaction_date", label: "Date", defaultWidth: 200, render: (row) => new Date((row as StockMovementReportRow).transaction_date).toLocaleString() },
      { key: "reason", label: "Reason", defaultWidth: 170, render: (row) => (row as StockMovementReportRow).reason },
      { key: "reference", label: "Reference", defaultWidth: 160, render: (row) => ((row as StockMovementReportRow).reference_type ? `${(row as StockMovementReportRow).reference_type} ${(row as StockMovementReportRow).reference_id ?? ""}`.trim() : "-") },
      { key: "product", label: "Product", defaultWidth: 180, render: (row) => (row as StockMovementReportRow).product },
      { key: "batch", label: "Batch", defaultWidth: 130, render: (row) => (row as StockMovementReportRow).batch },
      { key: "warehouse", label: "Warehouse", defaultWidth: 160, render: (row) => (row as StockMovementReportRow).warehouse },
      { key: "source_supplier", label: "Source Supplier", defaultWidth: 180, render: (row) => (row as StockMovementReportRow).source_supplier ?? "-" },
      { key: "source_po", label: "Source PO", defaultWidth: 150, render: (row) => (row as StockMovementReportRow).source_po ?? "-" },
      { key: "source_bill", label: "Source Bill", defaultWidth: 150, render: (row) => (row as StockMovementReportRow).source_bill ?? "-" },
      { key: "source_grn", label: "Source GRN", defaultWidth: 150, render: (row) => (row as StockMovementReportRow).source_grn ?? "-" },
      { key: "qty_in", label: "In", defaultWidth: 120, render: (row) => formatQuantity((row as StockMovementReportRow).qty_in, (row as StockMovementReportRow).quantity_precision) },
      { key: "qty_out", label: "Out", defaultWidth: 120, render: (row) => formatQuantity((row as StockMovementReportRow).qty_out, (row as StockMovementReportRow).quantity_precision) },
      { key: "running_balance", label: "Balance", defaultWidth: 130, render: (row) => formatQuantity((row as StockMovementReportRow).running_balance, (row as StockMovementReportRow).quantity_precision) },
    ];
  }

  if (kind === "stock-source-traceability") {
    return [
      { key: "sku", label: "SKU", defaultWidth: 130, render: (row) => (row as StockSourceTraceabilityReportRow).sku },
      { key: "product", label: "Product", defaultWidth: 200, render: (row) => (row as StockSourceTraceabilityReportRow).product },
      { key: "batch_no", label: "Batch", defaultWidth: 130, render: (row) => (row as StockSourceTraceabilityReportRow).batch_no },
      { key: "expiry_date", label: "Expiry", defaultWidth: 130, render: (row) => (row as StockSourceTraceabilityReportRow).expiry_date },
      { key: "warehouse", label: "Warehouse", defaultWidth: 160, render: (row) => (row as StockSourceTraceabilityReportRow).warehouse },
      { key: "qty_on_hand", label: "Qty On Hand", defaultWidth: 130, render: (row) => formatQuantity((row as StockSourceTraceabilityReportRow).qty_on_hand, (row as StockSourceTraceabilityReportRow).quantity_precision) },
      { key: "supplier_name", label: "Source Supplier", defaultWidth: 180, render: (row) => (row as StockSourceTraceabilityReportRow).supplier_name },
      { key: "po_number", label: "Source PO", defaultWidth: 150, render: (row) => (row as StockSourceTraceabilityReportRow).po_number },
      { key: "purchase_bill_number", label: "Source Bill", defaultWidth: 150, render: (row) => (row as StockSourceTraceabilityReportRow).purchase_bill_number ?? "-" },
      { key: "grn_number", label: "Source GRN", defaultWidth: 150, render: (row) => (row as StockSourceTraceabilityReportRow).grn_number },
      { key: "received_date", label: "Received On", defaultWidth: 130, render: (row) => (row as StockSourceTraceabilityReportRow).received_date },
      { key: "unit_cost", label: "Unit Cost", defaultWidth: 120, render: (row) => (row as StockSourceTraceabilityReportRow).unit_cost ?? "-" },
    ];
  }

  if (kind === "expiry") {
    return [
      { key: "product", label: "Product", defaultWidth: 180, render: (row) => (row as ExpiryReportRow).product },
      { key: "batch", label: "Batch", defaultWidth: 130, render: (row) => (row as ExpiryReportRow).batch },
      { key: "warehouse", label: "Warehouse", defaultWidth: 150, render: (row) => (row as ExpiryReportRow).warehouse },
      { key: "expiry_date", label: "Expiry", defaultWidth: 130, render: (row) => (row as ExpiryReportRow).expiry_date },
      { key: "days_to_expiry", label: "Days", defaultWidth: 100, render: (row) => (row as ExpiryReportRow).days_to_expiry },
      { key: "current_qty", label: "Qty", defaultWidth: 120, render: (row) => formatQuantity((row as ExpiryReportRow).current_qty, (row as ExpiryReportRow).quantity_precision) },
    ];
  }

  if (kind === "dead-stock") {
    return [
      { key: "product", label: "Product", defaultWidth: 180, render: (row) => (row as DeadStockReportRow).product },
      { key: "warehouse", label: "Warehouse", defaultWidth: 160, render: (row) => (row as DeadStockReportRow).warehouse },
      { key: "current_qty", label: "Qty", defaultWidth: 120, render: (row) => formatQuantity((row as DeadStockReportRow).current_qty, (row as DeadStockReportRow).quantity_precision) },
      { key: "last_movement_date", label: "Last Movement", defaultWidth: 200, render: (row) => ((row as DeadStockReportRow).last_movement_date ? new Date((row as DeadStockReportRow).last_movement_date as string).toLocaleString() : "-") },
      { key: "days_since_movement", label: "Days Idle", defaultWidth: 110, render: (row) => (row as DeadStockReportRow).days_since_movement ?? "-" },
    ];
  }

  if (kind === "stock-ageing") {
    return [
      { key: "product", label: "Product", defaultWidth: 180, render: (row) => (row as StockAgeingReportRow).product },
      { key: "warehouse", label: "Warehouse", defaultWidth: 160, render: (row) => (row as StockAgeingReportRow).warehouse },
      { key: "bucket_0_30", label: "0-30", defaultWidth: 100, render: (row) => formatQuantity((row as StockAgeingReportRow).bucket_0_30, (row as StockAgeingReportRow).quantity_precision) },
      { key: "bucket_31_60", label: "31-60", defaultWidth: 100, render: (row) => formatQuantity((row as StockAgeingReportRow).bucket_31_60, (row as StockAgeingReportRow).quantity_precision) },
      { key: "bucket_61_90", label: "61-90", defaultWidth: 100, render: (row) => formatQuantity((row as StockAgeingReportRow).bucket_61_90, (row as StockAgeingReportRow).quantity_precision) },
      { key: "bucket_90_plus", label: "90+", defaultWidth: 100, render: (row) => formatQuantity((row as StockAgeingReportRow).bucket_90_plus, (row as StockAgeingReportRow).quantity_precision) },
      { key: "total_qty", label: "Total", defaultWidth: 120, render: (row) => formatQuantity((row as StockAgeingReportRow).total_qty, (row as StockAgeingReportRow).quantity_precision) },
    ];
  }

  if (kind === "opening-stock") {
    return [
      { key: "sku", label: "SKU", defaultWidth: 130, render: (row) => (row as OpeningStockReportRow).sku },
      { key: "product_name", label: "Product Name", defaultWidth: 200, render: (row) => (row as OpeningStockReportRow).product_name },
      { key: "brand", label: "Brand", defaultWidth: 130, render: (row) => (row as OpeningStockReportRow).brand ?? "-" },
      { key: "category", label: "Category", defaultWidth: 120, render: (row) => (row as OpeningStockReportRow).category ?? "-" },
      { key: "warehouse", label: "Warehouse", defaultWidth: 160, render: (row) => (row as OpeningStockReportRow).warehouse },
      { key: "batch", label: "Batch", defaultWidth: 130, render: (row) => (row as OpeningStockReportRow).batch },
      { key: "expiry_date", label: "Expiry Date", defaultWidth: 130, render: (row) => (row as OpeningStockReportRow).expiry_date },
      { key: "opening_qty", label: "Opening Qty", defaultWidth: 130, render: (row) => formatQuantity((row as OpeningStockReportRow).opening_qty, (row as OpeningStockReportRow).quantity_precision) },
      { key: "current_qty", label: "Current Qty", defaultWidth: 130, render: (row) => formatQuantity((row as OpeningStockReportRow).current_qty, (row as OpeningStockReportRow).quantity_precision) },
      { key: "opening_value", label: "Opening Value", defaultWidth: 130, render: (row) => (row as OpeningStockReportRow).opening_value },
      { key: "last_opening_date", label: "Last Opening", defaultWidth: 200, render: (row) => ((row as OpeningStockReportRow).last_opening_date ? new Date((row as OpeningStockReportRow).last_opening_date as string).toLocaleString() : "-") },
    ];
  }

  return [
    { key: "sku", label: "SKU", defaultWidth: 130, render: (row) => (row as CurrentStockReportRow).sku },
    { key: "product_name", label: "Product Name", defaultWidth: 200, render: (row) => (row as CurrentStockReportRow).product_name },
    { key: "brand", label: "Brand", defaultWidth: 130, render: (row) => (row as CurrentStockReportRow).brand ?? "-" },
    { key: "category", label: "Category", defaultWidth: 120, render: (row) => (row as CurrentStockReportRow).category ?? "-" },
    { key: "warehouse", label: "Warehouse", defaultWidth: 160, render: (row) => (row as CurrentStockReportRow).warehouse },
    { key: "batch", label: "Batch", defaultWidth: 130, render: (row) => (row as CurrentStockReportRow).batch },
    { key: "expiry_date", label: "Expiry Date", defaultWidth: 130, render: (row) => (row as CurrentStockReportRow).expiry_date },
    { key: "available_qty", label: "Available Qty", defaultWidth: 130, render: (row) => formatQuantity((row as CurrentStockReportRow).available_qty, (row as CurrentStockReportRow).quantity_precision) },
    { key: "reserved_qty", label: "Reserved Qty", defaultWidth: 130, render: (row) => formatQuantity((row as CurrentStockReportRow).reserved_qty, (row as CurrentStockReportRow).quantity_precision) },
    { key: "stock_value", label: "Stock Value", defaultWidth: 130, render: (row) => (row as CurrentStockReportRow).stock_value },
    { key: "last_movement_date", label: "Last Movement", defaultWidth: 200, render: (row) => ((row as CurrentStockReportRow).last_movement_date ? new Date((row as CurrentStockReportRow).last_movement_date as string).toLocaleString() : "-") },
  ];
}

function buildQuery(
  kind: ReportKind,
  filters: ReportFilterState,
  page: number,
  pageSize: number,
) {
  const query: Record<string, string | number | boolean> = {
    page,
    page_size: pageSize,
  };

  if (filters.brandValues.length > 0) {
    query.brand_values = filters.brandValues.join(",");
  }
  if (filters.productIds.length > 0) {
    query.product_ids = filters.productIds.join(",");
  }
  if (filters.supplierIds.length > 0) {
    query.supplier_ids = filters.supplierIds.join(",");
  }
  if (filters.warehouseIds.length > 0) {
    query.warehouse_ids = filters.warehouseIds.join(",");
  }
  if (filters.categoryValues.length > 0) {
    query.category_values = filters.categoryValues.join(",");
  }
  if (filters.batchNos.length > 0) {
    query.batch_nos = filters.batchNos.join(",");
  }
  if (filters.dateFrom) {
    if (kind === "current-stock") {
      query.expiry_from = filters.dateFrom;
    } else {
      query.date_from = filters.dateFrom;
    }
  }
  if (filters.dateTo) {
    if (kind === "current-stock") {
      query.expiry_to = filters.dateTo;
    } else {
      query.date_to = filters.dateTo;
    }
  }
  if (filters.expiryStatus !== "all") {
    query.expiry_status = filters.expiryStatus;
  }
  if (kind === "expiry" && filters.expiryStatus === "all") {
    query.include_expired = true;
  }
  if (filters.stockStatus !== "all") {
    query.stock_status = filters.stockStatus;
  }
  if (kind === "current-stock" && filters.stockSource !== "all") {
    query.stock_source = filters.stockSource;
  }
  if (kind === "stock-source-traceability") {
    if (filters.poNumber.trim()) {
      query.po_number = filters.poNumber.trim();
    }
    if (filters.grnNumber.trim()) {
      query.grn_number = filters.grnNumber.trim();
    }
    if (filters.billNumber.trim()) {
      query.bill_number = filters.billNumber.trim();
    }
  }

  return query;
}

function toComparable(value: string | number): string | number {
  const parsed = Number(value);
  if (!Number.isNaN(parsed) && `${value}`.trim() !== "") {
    return parsed;
  }
  return `${value}`.toLowerCase();
}

function formatMetricNumber(value: string | number) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return String(value);
  }
  return parsed.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function cloneReportFilters(filters: ReportFilterState): ReportFilterState {
  return {
    ...filters,
    brandValues: [...filters.brandValues],
    productIds: [...filters.productIds],
    supplierIds: [...filters.supplierIds],
    warehouseIds: [...filters.warehouseIds],
    categoryValues: [...filters.categoryValues],
    batchNos: [...filters.batchNos],
    poNumber: filters.poNumber,
    grnNumber: filters.grnNumber,
    billNumber: filters.billNumber,
  };
}

export function ReportView({ kind }: { kind: ReportKind }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterOptions, setFilterOptions] = useState<ReportFilterOptions>({
    brands: [],
    categories: [],
    batches: [],
    products: [],
    suppliers: [],
    warehouses: [],
  });
  const [draftFilters, setDraftFilters] = useState<ReportFilterState>(defaultReportFilters);
  const [appliedFilters, setAppliedFilters] = useState<ReportFilterState>(defaultReportFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<SortState | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [currentStockSummary, setCurrentStockSummary] = useState<CurrentStockSummary | null>(null);
  const [openingStockSummary, setOpeningStockSummary] = useState<OpeningStockSummary | null>(null);
  const [sourceDetailOpen, setSourceDetailOpen] = useState(false);
  const [sourceDetailLoading, setSourceDetailLoading] = useState(false);
  const [sourceDetailError, setSourceDetailError] = useState<string | null>(null);
  const [sourceDetail, setSourceDetail] = useState<CurrentStockSourceDetailResponse | null>(null);

  const meta = reportMeta[kind];
  const columns = useMemo(() => columnsForKind(kind), [kind]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showStockStatus = kind === "current-stock";
  const showStockSource = kind === "current-stock";
  const showDocumentFilters = kind === "stock-source-traceability";
  const currentStockMetrics = useMemo<MetricCardDef[]>(
    () =>
      currentStockSummary
        ? [
            {
              label: "Total SKUs",
              value: currentStockSummary.total_skus,
              icon: PackageSearch,
              accent: "primary",
            },
            {
              label: "Total Stock Quantity",
              value: currentStockSummary.total_stock_qty,
              icon: Boxes,
              accent: "success",
            },
            {
              label: "Total Stock Value",
              value: currentStockSummary.total_stock_value,
              icon: Wallet,
              accent: "warning",
            },
            {
              label: "Items Expiring Soon",
              value: currentStockSummary.items_expiring_soon,
              icon: AlertTriangle,
              accent: "danger",
            },
          ]
        : [],
    [currentStockSummary],
  );
  const openingStockMetrics = useMemo<MetricCardDef[]>(
    () =>
      openingStockSummary
        ? [
            {
              label: "Total SKUs",
              value: openingStockSummary.total_skus,
              icon: PackageSearch,
              accent: "primary",
            },
            {
              label: "Total Opening Quantity",
              value: openingStockSummary.total_opening_qty,
              icon: Boxes,
              accent: "success",
            },
            {
              label: "Total Opening Value",
              value: openingStockSummary.total_opening_value,
              icon: Wallet,
              accent: "warning",
            },
          ]
        : [],
    [openingStockSummary],
  );

  useEffect(() => {
    const widths: Record<string, number> = {};
    for (const column of columns) {
      widths[column.key] = column.defaultWidth ?? 140;
    }
    setColumnWidths(widths);
    setSort(null);
  }, [columns]);

  useEffect(() => {
    let cancelled = false;
    const loadOptions = async () => {
      try {
        const options = await apiClient.getReportFilterOptions();
        if (!cancelled) {
          setFilterOptions(options);
        }
      } catch {
        if (!cancelled) {
          setFilterOptions({
            brands: [],
            categories: [],
            batches: [],
            products: [],
            suppliers: [],
            warehouses: [],
          });
        }
      }
    };
    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (kind === "purchase-credit-notes") {
        const response = await apiClient.listPurchaseCreditNotes();
        const filtered = response.filter((row) => {
          if (
            appliedFilters.supplierIds.length > 0 &&
            !appliedFilters.supplierIds.includes(String(row.supplier_id))
          ) {
            return false;
          }
          if (
            appliedFilters.warehouseIds.length > 0 &&
            !appliedFilters.warehouseIds.includes(String(row.warehouse_id))
          ) {
            return false;
          }
          if (appliedFilters.dateFrom && row.created_at.slice(0, 10) < appliedFilters.dateFrom) {
            return false;
          }
          if (appliedFilters.dateTo && row.created_at.slice(0, 10) > appliedFilters.dateTo) {
            return false;
          }
          return true;
        });

        const start = (page - 1) * pageSize;
        setRows(filtered.slice(start, start + pageSize));
        setTotal(filtered.length);
        setCurrentStockSummary(null);
        setOpeningStockSummary(null);
        return;
      }

      const query = buildQuery(kind, appliedFilters, page, pageSize);
      if (kind === "current-stock") {
        const response = await apiClient.getCurrentStockReport(query);
        setRows(response.data);
        setTotal(response.total);
        setCurrentStockSummary(response.summary);
        setOpeningStockSummary(null);
        return;
      }
      if (kind === "opening-stock") {
        const response = await apiClient.getOpeningStockReport(query);
        setRows(response.data);
        setTotal(response.total);
        setOpeningStockSummary(response.summary);
        setCurrentStockSummary(null);
        return;
      }
      if (kind === "stock-source-traceability") {
        const response = await apiClient.getStockSourceTraceabilityReport(query);
        setRows(response.data);
        setTotal(response.total);
        setCurrentStockSummary(null);
        setOpeningStockSummary(null);
        return;
      }

      const response =
        kind === "stock-inward"
          ? await apiClient.getStockInwardReport(query)
          : kind === "purchase-register"
            ? await apiClient.getPurchaseRegisterReport(query)
            : kind === "stock-movement"
              ? await apiClient.getStockMovementReport(query)
              : kind === "expiry"
                ? await apiClient.getExpiryReport(query)
                : kind === "dead-stock"
                  ? await apiClient.getDeadStockReport(query)
                  : await apiClient.getStockAgeingReport(query);

      setRows(response.data);
      setTotal(response.total);
      setCurrentStockSummary(null);
      setOpeningStockSummary(null);
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.code === "UNAUTHORIZED") {
        try {
          await apiClient.logout();
        } catch {
          // Ignore logout failures and force re-auth.
        }
        window.location.replace("/login");
        return;
      }
      setError(caught instanceof Error ? caught.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, kind, page, pageSize]);

  const openSourceDetail = useCallback(async (row: CurrentStockReportRow) => {
    setSourceDetailOpen(true);
    setSourceDetailLoading(true);
    setSourceDetailError(null);
    try {
      const detail = await apiClient.getCurrentStockSourceDetail({
        warehouse_id: row.warehouse_id,
        product_id: row.product_id,
        batch_id: row.batch_id,
      });
      setSourceDetail(detail);
    } catch (caught) {
      setSourceDetail(null);
      setSourceDetailError(caught instanceof Error ? caught.message : "Failed to load source detail");
    } finally {
      setSourceDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedRows = useMemo(() => {
    if (!sort) {
      return rows;
    }

    const column = columns.find((entry) => entry.key === sort.key);
    if (!column) {
      return rows;
    }

    return [...rows].sort((left, right) => {
      const leftValue = toComparable(column.render(left));
      const rightValue = toComparable(column.render(right));

      if (leftValue < rightValue) {
        return sort.direction === "asc" ? -1 : 1;
      }
      if (leftValue > rightValue) {
        return sort.direction === "asc" ? 1 : -1;
      }
      return 0;
    });
  }, [columns, rows, sort]);

  const rowsForExport = useMemo(
    () =>
      sortedRows.map((row) =>
        columns.reduce<Record<string, string | number>>((accumulator, column) => {
          accumulator[column.label] = column.render(row);
          return accumulator;
        }, {}),
      ),
    [columns, sortedRows],
  );

  const onStartResize = (key: string, event: React.MouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = columnWidths[key] ?? 140;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(90, startWidth + (moveEvent.clientX - startX));
      setColumnWidths((current) => ({ ...current, [key]: nextWidth }));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const exportCsv = () => {
    if (rowsForExport.length === 0) {
      return;
    }
    const headers = Object.keys(rowsForExport[0]);
    const lines = [
      headers.join(","),
      ...rowsForExport.map((row) =>
        headers
          .map((header) => {
            const value = row[header] ?? "";
            const text = String(value).replaceAll('"', '""');
            return `"${text}"`;
          })
          .join(","),
      ),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${kind}-report.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = () => {
    if (rowsForExport.length === 0) {
      return;
    }
    const headers = Object.keys(rowsForExport[0]);
    const html = `
      <table>
        <thead>
          <tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rowsForExport
            .map(
              (row) =>
                `<tr>${headers
                  .map((header) => `<td>${String(row[header] ?? "")}</td>`)
                  .join("")}</tr>`,
            )
            .join("")}
        </tbody>
      </table>
    `;
    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${kind}-report.xls`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <PageTitle title={meta.title} description={meta.description} />

      <ReportFilterBar
        options={filterOptions}
        value={draftFilters}
        onChange={setDraftFilters}
        onApply={() => {
          setAppliedFilters(cloneReportFilters(draftFilters));
          setPage(1);
        }}
        onClear={() => {
          const cleared = cloneReportFilters(defaultReportFilters);
          setDraftFilters(cleared);
          setAppliedFilters(cleared);
          setPage(1);
        }}
        showStockStatus={showStockStatus}
        showStockSource={showStockSource}
        showDocumentFilters={showDocumentFilters}
      />

      {kind === "current-stock" && currentStockSummary ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {currentStockMetrics.map((metric) => (
            <MetricCard
              key={metric.label}
              title={metric.label}
              value={formatMetricNumber(metric.value)}
              icon={metric.icon}
              accent={metric.accent}
            />
          ))}
        </div>
      ) : null}

      {kind === "opening-stock" && openingStockSummary ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {openingStockMetrics.map((metric) => (
            <MetricCard
              key={metric.label}
              title={metric.label}
              value={formatMetricNumber(metric.value)}
              icon={metric.icon}
              accent={metric.accent}
            />
          ))}
        </div>
      ) : null}

      <AppTable
        title="Rows"
        description={`${total} records available.`}
        actions={
          <>
            <Button variant="outline" onClick={() => void load()} className="gap-1 rounded-xl">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button variant="outline" onClick={exportCsv} className="gap-1 rounded-xl">
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <Button variant="outline" onClick={exportExcel} className="gap-1 rounded-xl">
              <FileSpreadsheet className="h-4 w-4" />
              Export Excel
            </Button>
            <Button variant="outline" onClick={() => window.print()} className="gap-1 rounded-xl">
              <Printer className="h-4 w-4" />
              Print
            </Button>
          </>
        }
      >
        <div className="space-y-4 p-5 md:p-6">
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
              {error}
            </div>
          ) : null}
          {loading ? (
            <div className="rounded-2xl border border-border bg-[hsl(var(--surface-muted))] px-4 py-6 text-sm text-[hsl(var(--text-secondary))]">
              Loading report...
            </div>
          ) : null}
          {!loading && !error && rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-[hsl(var(--surface-muted))] px-4 py-8 text-center text-sm text-[hsl(var(--text-secondary))]">
              No report rows found.
            </div>
          ) : null}

          {!loading && !error && rows.length > 0 ? (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-2xl border border-border bg-[hsl(var(--surface-elevated))] shadow-sm">
                <Table className="table-fixed min-w-[1100px]">
                  <TableHeader className="sticky top-0 z-10 bg-[hsl(var(--table-header))]/95 backdrop-blur supports-[backdrop-filter]:bg-[hsl(var(--table-header))]/90">
                    <TableRow>
                      {columns.map((column) => (
                        <TableHead
                          key={column.key}
                          style={{ width: `${columnWidths[column.key] ?? column.defaultWidth ?? 140}px` }}
                          className="relative select-none border-b border-border/80 text-[hsl(var(--text-secondary))]"
                        >
                          <button
                            type="button"
                            className="w-full text-left"
                            onClick={() =>
                              setSort((current) => {
                                if (current?.key === column.key) {
                                  return {
                                    key: column.key,
                                    direction: current.direction === "asc" ? "desc" : "asc",
                                  };
                                }
                                return { key: column.key, direction: "asc" };
                              })
                            }
                          >
                            {column.label}
                          </button>
                          <span
                            role="separator"
                            onMouseDown={(event) => onStartResize(column.key, event)}
                            className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/30"
                          />
                        </TableHead>
                      ))}
                      {kind === "current-stock" ? (
                        <TableHead className="border-b border-border/80 text-[hsl(var(--text-secondary))]">
                          Batch Origin
                        </TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRows.map((row, rowIndex) => (
                      <TableRow
                        key={`${kind}-${rowIndex}`}
                        className="border-b border-border/70 bg-[hsl(var(--surface))] even:bg-[hsl(var(--surface-muted))]/70 hover:bg-[hsl(var(--hover))]"
                      >
                        {columns.map((column) => (
                          <TableCell
                            key={`${column.key}-${rowIndex}`}
                            style={{ width: `${columnWidths[column.key] ?? column.defaultWidth ?? 140}px` }}
                            className="py-3 text-[hsl(var(--text-primary))]"
                          >
                            {column.render(row)}
                          </TableCell>
                        ))}
                        {kind === "current-stock" ? (
                          <TableCell className="py-3 text-[hsl(var(--text-primary))]">
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-xl"
                              onClick={() => void openSourceDetail(row as CurrentStockReportRow)}
                            >
                              View Source
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-[hsl(var(--surface-muted))] px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-[hsl(var(--text-secondary))]">
                  <span>Page Size</span>
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value));
                      setPage(1);
                    }}
                    className="h-9 rounded-xl border border-border bg-[hsl(var(--surface-elevated))] px-3 text-[hsl(var(--text-primary))]"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    className="rounded-xl"
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-[hsl(var(--text-secondary))]">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    disabled={page >= totalPages}
                    onClick={() =>
                      setPage((current) => Math.min(totalPages, current + 1))
                    }
                    className="rounded-xl"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </AppTable>

      <Transition appear show={sourceDetailOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={() => setSourceDetailOpen(false)}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <DialogBackdrop className="fixed inset-0 bg-slate-950/35 backdrop-blur-sm" />
          </TransitionChild>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-end">
              <TransitionChild
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="translate-x-full opacity-0"
                enterTo="translate-x-0 opacity-100"
                leave="ease-in duration-150"
                leaveFrom="translate-x-0 opacity-100"
                leaveTo="translate-x-full opacity-0"
              >
                <DialogPanel className="h-full w-full max-w-3xl overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
                  <div className="space-y-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-xl font-semibold text-[hsl(var(--text-primary))]">
                          Batch Origin
                        </h2>
                        <p className="text-sm text-[hsl(var(--text-secondary))]">
                          Supplier and purchase document chain for this stock bucket.
                        </p>
                      </div>
                      <Button type="button" variant="outline" onClick={() => setSourceDetailOpen(false)}>
                        Close
                      </Button>
                    </div>

                    {sourceDetailLoading ? (
                      <div className="rounded-2xl border border-border bg-[hsl(var(--surface-muted))] px-4 py-6 text-sm text-[hsl(var(--text-secondary))]">
                        Loading source detail...
                      </div>
                    ) : null}
                    {sourceDetailError ? (
                      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
                        {sourceDetailError}
                      </div>
                    ) : null}
                    {sourceDetail ? (
                      <>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="rounded-2xl border border-border bg-[hsl(var(--surface-muted))] p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">
                              Product
                            </p>
                            <p className="mt-1 text-lg font-semibold text-[hsl(var(--text-primary))]">
                              {sourceDetail.product_name}
                            </p>
                            <p className="mt-2 text-sm text-[hsl(var(--text-secondary))]">
                              SKU: {sourceDetail.sku}
                            </p>
                            <p className="text-sm text-[hsl(var(--text-secondary))]">
                              Warehouse: {sourceDetail.warehouse}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-border bg-[hsl(var(--surface-muted))] p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--text-secondary))]">
                              Batch Details
                            </p>
                            <p className="mt-1 text-lg font-semibold text-[hsl(var(--text-primary))]">
                              {sourceDetail.batch_no}
                            </p>
                            <p className="mt-2 text-sm text-[hsl(var(--text-secondary))]">
                              Expiry: {sourceDetail.expiry_date}
                            </p>
                            <p className="text-sm text-[hsl(var(--text-secondary))]">
                              Qty On Hand:{" "}
                              {formatQuantity(sourceDetail.qty_on_hand, sourceDetail.quantity_precision)}
                            </p>
                          </div>
                        </div>

                        <div className="overflow-hidden rounded-2xl border border-border">
                          <Table>
                            <TableHeader className="bg-[hsl(var(--table-header))]">
                              <TableRow>
                                <TableHead>Source Supplier</TableHead>
                                <TableHead>Source PO</TableHead>
                                <TableHead>Source Bill</TableHead>
                                <TableHead>Source GRN</TableHead>
                                <TableHead>Received On</TableHead>
                                <TableHead>Received Qty</TableHead>
                                <TableHead>Free Qty</TableHead>
                                <TableHead>Unit Cost</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {sourceDetail.sources.map((row) => (
                                <TableRow
                                  key={`${row.grn_batch_line_id}-${row.grn_line_id}`}
                                  className="bg-[hsl(var(--surface))] even:bg-[hsl(var(--surface-muted))]/70"
                                >
                                  <TableCell>{row.supplier_name}</TableCell>
                                  <TableCell>{row.po_number}</TableCell>
                                  <TableCell>{row.purchase_bill_number ?? "-"}</TableCell>
                                  <TableCell>{row.grn_number}</TableCell>
                                  <TableCell>{row.received_date}</TableCell>
                                  <TableCell>{formatQuantity(row.received_qty, sourceDetail.quantity_precision)}</TableCell>
                                  <TableCell>{formatQuantity(row.free_qty, sourceDetail.quantity_precision)}</TableCell>
                                  <TableCell>{row.unit_cost ?? "-"}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </>
                    ) : null}
                  </div>
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}
