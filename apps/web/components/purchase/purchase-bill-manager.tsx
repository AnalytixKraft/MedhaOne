"use client";

import { FileText, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { usePermissions } from "@/components/auth/permission-provider";
import {
  AppActionBar,
  AppFormGrid,
  AppPageHeader,
  AppSectionCard,
  AppTable,
} from "@/components/erp/app-primitives";
import { Button } from "@/components/ui/button";
import { ErpCombobox } from "@/components/ui/erp-combobox";
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
  Party,
  Product,
  PurchaseBill,
  PurchaseBillLine,
  PurchaseBillUpdatePayload,
  Warehouse,
  apiClient,
} from "@/lib/api/client";
import { cn } from "@/lib/utils";

type EditableLine = {
  id: number;
  product_id: string;
  description_raw: string;
  hsn_code: string;
  qty: string;
  unit: string;
  unit_price: string;
  discount_amount: string;
  gst_percent: string;
  line_total: string;
  batch_no: string;
  expiry_date: string;
  confidence_score: string;
};

type EditableBill = {
  id: number;
  bill_number: string;
  supplier_id: string;
  supplier_name_raw: string;
  supplier_gstin: string;
  bill_date: string;
  due_date: string;
  warehouse_id: string;
  subtotal: string;
  discount_amount: string;
  taxable_value: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  adjustment: string;
  total: string;
  purchase_order_id: string;
  grn_id: string;
  remarks: string;
  status: PurchaseBill["status"];
  extraction_status: PurchaseBill["extraction_status"];
  extraction_confidence: string;
  attachment_id: number | null;
  attachment_file_type: string | null;
  lines: EditableLine[];
};

const amountFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function toStringValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function toNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function createDraftFromBill(bill: PurchaseBill): EditableBill {
  return {
    id: bill.id,
    bill_number: bill.bill_number,
    supplier_id: toStringValue(bill.supplier_id),
    supplier_name_raw: bill.supplier_name_raw ?? "",
    supplier_gstin: bill.supplier_gstin ?? "",
    bill_date: bill.bill_date ?? "",
    due_date: bill.due_date ?? "",
    warehouse_id: toStringValue(bill.warehouse_id),
    subtotal: bill.subtotal,
    discount_amount: bill.discount_amount,
    taxable_value: bill.taxable_value,
    cgst_amount: bill.cgst_amount,
    sgst_amount: bill.sgst_amount,
    igst_amount: bill.igst_amount,
    adjustment: bill.adjustment,
    total: bill.total,
    purchase_order_id: toStringValue(bill.purchase_order_id),
    grn_id: toStringValue(bill.grn_id),
    remarks: bill.remarks ?? "",
    status: bill.status,
    extraction_status: bill.extraction_status,
    extraction_confidence: bill.extraction_confidence ?? "",
    attachment_id: bill.attachment_id,
    attachment_file_type: bill.attachment?.file_type ?? null,
    lines: bill.lines.map((line) => ({
      id: line.id,
      product_id: toStringValue(line.product_id),
      description_raw: line.description_raw,
      hsn_code: line.hsn_code ?? "",
      qty: line.qty,
      unit: line.unit ?? "",
      unit_price: line.unit_price,
      discount_amount: line.discount_amount,
      gst_percent: line.gst_percent,
      line_total: line.line_total,
      batch_no: line.batch_no ?? "",
      expiry_date: line.expiry_date ?? "",
      confidence_score: line.confidence_score ?? "",
    })),
  };
}

function buildUpdatePayload(draft: EditableBill): PurchaseBillUpdatePayload {
  return {
    bill_number: draft.bill_number,
    supplier_id: draft.supplier_id ? Number(draft.supplier_id) : null,
    supplier_name_raw: draft.supplier_name_raw || null,
    supplier_gstin: draft.supplier_gstin || null,
    bill_date: draft.bill_date || null,
    due_date: draft.due_date || null,
    warehouse_id: draft.warehouse_id ? Number(draft.warehouse_id) : null,
    subtotal: draft.subtotal,
    discount_amount: draft.discount_amount,
    taxable_value: draft.taxable_value,
    cgst_amount: draft.cgst_amount,
    sgst_amount: draft.sgst_amount,
    igst_amount: draft.igst_amount,
    adjustment: draft.adjustment,
    total: draft.total,
    purchase_order_id: draft.purchase_order_id ? Number(draft.purchase_order_id) : null,
    grn_id: draft.grn_id ? Number(draft.grn_id) : null,
    remarks: draft.remarks || null,
    lines: draft.lines.map((line) => ({
      product_id: line.product_id ? Number(line.product_id) : null,
      description_raw: line.description_raw,
      hsn_code: line.hsn_code || null,
      qty: line.qty,
      unit: line.unit || null,
      unit_price: line.unit_price,
      discount_amount: line.discount_amount,
      gst_percent: line.gst_percent,
      line_total: line.line_total,
      batch_no: line.batch_no || null,
      expiry_date: line.expiry_date || null,
      confidence_score: line.confidence_score || null,
    })),
  };
}

function statusBadgeClass(status: PurchaseBill["status"]) {
  switch (status) {
    case "POSTED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300";
    case "VERIFIED":
      return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300";
    case "CANCELLED":
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300";
  }
}

export function PurchaseBillManager() {
  const { hasPermission, loading: permissionLoading } = usePermissions();
  const [bills, setBills] = useState<PurchaseBill[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedBillId, setSelectedBillId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditableBill | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadWarehouseId, setUploadWarehouseId] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryMessage, setSummaryMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [billRes, partyRes, warehouseRes, productRes] = await Promise.all([
        apiClient.listPurchaseBills(),
        apiClient.listParties(),
        apiClient.listWarehouses(),
        apiClient.listProducts(),
      ]);
      setBills(billRes.items);
      setSuppliers(partyRes);
      setWarehouses(warehouseRes);
      setProducts(productRes);
      setSelectedBillId((current) => current ?? billRes.items[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load purchase bill workspace");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selectedBill = useMemo(
    () => bills.find((bill) => bill.id === selectedBillId) ?? null,
    [bills, selectedBillId],
  );

  useEffect(() => {
    if (!selectedBill) {
      setDraft(null);
      return;
    }
    setDraft(createDraftFromBill(selectedBill));
  }, [selectedBill]);

  const supplierOptions = useMemo(
    () =>
      suppliers.map((supplier) => ({
        label: supplier.name,
        value: String(supplier.id),
      })),
    [suppliers],
  );

  const warehouseOptions = useMemo(
    () =>
      warehouses.map((warehouse) => ({
        label: warehouse.name,
        value: String(warehouse.id),
      })),
    [warehouses],
  );

  const productOptions = useMemo(
    () =>
      products.map((product) => ({
        label: `${product.sku} - ${product.name}`,
        value: String(product.id),
      })),
    [products],
  );

  const selectedSupplier = useMemo(
    () =>
      suppliers.find((supplier) => String(supplier.id) === draft?.supplier_id) ?? null,
    [draft?.supplier_id, suppliers],
  );

  const previewUrl =
    draft?.attachment_id !== null && draft?.attachment_id !== undefined
      ? `/api/purchase-bills/attachments/${draft.attachment_id}`
      : null;

  const warnings = useMemo(() => {
    if (!draft) {
      return [];
    }

    const warningItems: string[] = [];
    const confidence = toNumber(draft.extraction_confidence);
    if (draft.extraction_confidence && confidence < 0.75) {
      warningItems.push("Low confidence extraction");
    }
    if (!draft.supplier_id) {
      warningItems.push("Unmatched supplier");
    }
    if (draft.lines.some((line) => !line.product_id)) {
      warningItems.push("Unmatched product lines");
    }
    const expectedTotal =
      toNumber(draft.taxable_value) +
      toNumber(draft.cgst_amount) +
      toNumber(draft.sgst_amount) +
      toNumber(draft.igst_amount) +
      toNumber(draft.adjustment);
    if (Math.abs(expectedTotal - toNumber(draft.total)) > 0.01) {
      warningItems.push("Total mismatch");
    }
    if (toNumber(draft.cgst_amount) > 0 && toNumber(draft.igst_amount) > 0) {
      warningItems.push("Tax mismatch");
    }
    return warningItems;
  }, [draft]);

  const updateDraft = (patch: Partial<EditableBill>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const updateLine = (lineId: number, patch: Partial<EditableLine>) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        lines: current.lines.map((line) =>
          line.id === lineId ? { ...line, ...patch } : line,
        ),
      };
    });
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      setError("Choose a PDF or image invoice to upload.");
      return;
    }
    setUploading(true);
    setError(null);
    setSummaryMessage(null);
    try {
      const created = await apiClient.uploadPurchaseBill(
        uploadFile,
        uploadWarehouseId ? Number(uploadWarehouseId) : undefined,
      );
      await load();
      setSelectedBillId(created.id);
      setUploadFile(null);
      setUploadWarehouseId("");
      setSummaryMessage("Invoice uploaded and draft purchase bill created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload invoice");
    } finally {
      setUploading(false);
    }
  };

  const persistDraft = async () => {
    if (!draft) {
      return;
    }
    setSaving(true);
    setError(null);
    setSummaryMessage(null);
    try {
      const updated = await apiClient.updatePurchaseBill(draft.id, buildUpdatePayload(draft));
      await load();
      setSelectedBillId(updated.id);
      setSummaryMessage("Draft purchase bill saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save purchase bill draft");
    } finally {
      setSaving(false);
    }
  };

  const transitionBill = async (action: "verify" | "post" | "cancel") => {
    if (!draft) {
      return;
    }
    setSaving(true);
    setError(null);
    setSummaryMessage(null);
    try {
      if (action === "verify") {
        await apiClient.updatePurchaseBill(draft.id, buildUpdatePayload(draft));
        await apiClient.verifyPurchaseBill(draft.id);
        setSummaryMessage("Purchase bill verified for posting.");
      } else if (action === "post") {
        await apiClient.postPurchaseBill(draft.id);
        setSummaryMessage("Purchase bill posted. No stock movement was created.");
      } else {
        await apiClient.cancelPurchaseBill(draft.id);
        setSummaryMessage("Purchase bill cancelled.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} purchase bill`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <AppPageHeader
        title="Purchase Bills"
        description="Upload supplier invoices, review AI-assisted extraction, and verify draft bills before posting. Posting a purchase bill does not create stock movement."
        actions={
          hasPermission("purchase_bill:upload") ? (
            <div className="flex flex-wrap items-center gap-2">
              <ErpCombobox
                className="min-w-[220px]"
                options={warehouseOptions}
                value={uploadWarehouseId}
                onValueChange={setUploadWarehouseId}
                placeholder="Optional warehouse"
                searchPlaceholder="Search warehouse"
                emptyMessage="No warehouses"
              />
              <Input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                className="max-w-[280px]"
              />
              <Button onClick={handleUpload} disabled={uploading}>
                <Sparkles className="mr-2 h-4 w-4" />
                {uploading ? "Uploading..." : "Upload Invoice"}
              </Button>
            </div>
          ) : null
        }
      />

      {error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </p>
      ) : null}
      {summaryMessage ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
          {summaryMessage}
        </p>
      ) : null}

      <AppTable title="Purchase Bills" description="Draft and review uploaded supplier invoices before verification and posting.">
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading purchase bills...</p>
        ) : (
          <Table>
            <TableHeader className="bg-[hsl(var(--table-header-bg))]">
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">Bill No</TableHead>
                <TableHead className="px-4">Supplier</TableHead>
                <TableHead className="px-4">Status</TableHead>
                <TableHead className="px-4">Extraction</TableHead>
                <TableHead className="px-4 text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.map((bill) => (
                <TableRow
                  key={bill.id}
                  className={cn(
                    "cursor-pointer [&:nth-child(even)]:bg-[hsl(var(--muted-bg))]/60",
                    selectedBillId === bill.id && "bg-sky-50/80 dark:bg-sky-950/20",
                  )}
                  onClick={() => setSelectedBillId(bill.id)}
                >
                  <TableCell className="px-4 py-3 font-medium">{bill.bill_number}</TableCell>
                  <TableCell className="px-4 py-3">{bill.supplier_name_raw ?? "-"}</TableCell>
                  <TableCell className="px-4 py-3">
                    <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", statusBadgeClass(bill.status))}>
                      {bill.status}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-3">{bill.extraction_status}</TableCell>
                  <TableCell className="px-4 py-3 text-right tabular-nums">
                    {amountFormatter.format(toNumber(bill.total))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AppTable>

      {draft ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)]">
          <AppSectionCard
            title="Invoice Preview"
            description="Review the uploaded document while correcting the extracted draft."
          >
            {previewUrl ? (
              draft.attachment_file_type?.startsWith("image/") ? (
                <img
                  src={previewUrl}
                  alt={draft.bill_number}
                  className="w-full rounded-2xl border border-border object-contain"
                />
              ) : (
                <iframe
                  src={previewUrl}
                  title={draft.bill_number}
                  className="min-h-[820px] w-full rounded-2xl border border-border bg-white"
                />
              )
            ) : (
              <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-[hsl(var(--muted-bg))]/60 text-center text-sm text-[hsl(var(--text-secondary))]">
                <FileText className="mb-3 h-8 w-8" />
                No attachment preview available for this purchase bill.
              </div>
            )}
          </AppSectionCard>

          <div className="flex flex-col gap-6">
            <AppSectionCard
              title="Bill Review"
              description="Confirm supplier matching, totals, and line mapping before verification."
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", statusBadgeClass(draft.status))}>
                  {draft.status}
                </span>
                <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
                  {draft.extraction_status}
                </span>
                {warnings.map((warning) => (
                  <span
                    key={warning}
                    className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
                  >
                    {warning}
                  </span>
                ))}
                {selectedSupplier ? (
                  <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                    Matched supplier
                  </span>
                ) : null}
              </div>

              <AppFormGrid className="xl:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
                    Bill Number
                  </span>
                  <Input
                    value={draft.bill_number}
                    onChange={(event) => updateDraft({ bill_number: event.target.value })}
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
                    Supplier
                  </span>
                  <ErpCombobox
                    options={supplierOptions}
                    value={draft.supplier_id}
                    onValueChange={(value) => updateDraft({ supplier_id: value })}
                    placeholder="Select supplier"
                    searchPlaceholder="Search supplier"
                    emptyMessage="No matching suppliers"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
                    Supplier Name (Raw)
                  </span>
                  <Input
                    value={draft.supplier_name_raw}
                    onChange={(event) => updateDraft({ supplier_name_raw: event.target.value })}
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
                    Supplier GSTIN
                  </span>
                  <Input
                    value={draft.supplier_gstin}
                    onChange={(event) => updateDraft({ supplier_gstin: event.target.value.toUpperCase() })}
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
                    Bill Date
                  </span>
                  <Input
                    type="date"
                    value={draft.bill_date}
                    onChange={(event) => updateDraft({ bill_date: event.target.value })}
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
                    Due Date
                  </span>
                  <Input
                    type="date"
                    value={draft.due_date}
                    onChange={(event) => updateDraft({ due_date: event.target.value })}
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
                    Warehouse
                  </span>
                  <ErpCombobox
                    options={warehouseOptions}
                    value={draft.warehouse_id}
                    onValueChange={(value) => updateDraft({ warehouse_id: value })}
                    placeholder="Select warehouse"
                    searchPlaceholder="Search warehouse"
                    emptyMessage="No matching warehouses"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
                    Extraction Confidence
                  </span>
                  <Input
                    value={draft.extraction_confidence}
                    onChange={(event) => updateDraft({ extraction_confidence: event.target.value })}
                  />
                </label>
              </AppFormGrid>
            </AppSectionCard>

            <AppSectionCard
              title="Tax Summary"
              description="Review extracted totals before verification. Posting the bill will not impact stock."
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: "Subtotal", field: "subtotal", value: draft.subtotal },
                  { label: "Discount", field: "discount_amount", value: draft.discount_amount },
                  { label: "Taxable Value", field: "taxable_value", value: draft.taxable_value },
                  { label: "CGST", field: "cgst_amount", value: draft.cgst_amount },
                  { label: "SGST", field: "sgst_amount", value: draft.sgst_amount },
                  { label: "IGST", field: "igst_amount", value: draft.igst_amount },
                  { label: "Adjustment", field: "adjustment", value: draft.adjustment },
                  { label: "Total", field: "total", value: draft.total },
                ].map((item) => (
                  <label key={item.field} className="space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
                      {item.label}
                    </span>
                    <Input
                      value={item.value}
                      onChange={(event) =>
                        updateDraft({
                          [item.field]: event.target.value,
                        } as Partial<EditableBill>)
                      }
                    />
                  </label>
                ))}
              </div>
            </AppSectionCard>

            <AppSectionCard
              title="Bill Lines"
              description="Keep unmatched descriptions visible and only confirm product mapping when you are certain."
            >
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-[hsl(var(--table-header-bg))]">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Description</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Unit Price</TableHead>
                      <TableHead>GST %</TableHead>
                      <TableHead>Line Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draft.lines.map((line) => (
                      <TableRow key={line.id} className="[&:nth-child(even)]:bg-[hsl(var(--muted-bg))]/60">
                        <TableCell className="min-w-[220px]">
                          <Input
                            value={line.description_raw}
                            onChange={(event) => updateLine(line.id, { description_raw: event.target.value })}
                          />
                        </TableCell>
                        <TableCell className="min-w-[220px]">
                          <select
                            value={line.product_id}
                            onChange={(event) => {
                              const selectedProduct = products.find(
                                (product) => String(product.id) === event.target.value,
                              );
                              updateLine(line.id, {
                                product_id: event.target.value,
                                hsn_code: selectedProduct?.hsn ?? line.hsn_code,
                              });
                            }}
                            className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                          >
                            <option value="">Unmatched</option>
                            {productOptions.map((product) => (
                              <option key={product.value} value={product.value}>
                                {product.label}
                              </option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell><Input value={line.qty} onChange={(event) => updateLine(line.id, { qty: event.target.value })} /></TableCell>
                        <TableCell><Input value={line.unit} onChange={(event) => updateLine(line.id, { unit: event.target.value })} /></TableCell>
                        <TableCell><Input value={line.unit_price} onChange={(event) => updateLine(line.id, { unit_price: event.target.value })} /></TableCell>
                        <TableCell><Input value={line.gst_percent} onChange={(event) => updateLine(line.id, { gst_percent: event.target.value })} /></TableCell>
                        <TableCell><Input value={line.line_total} onChange={(event) => updateLine(line.id, { line_total: event.target.value })} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </AppSectionCard>

            <AppActionBar>
              <Button
                variant="outline"
                onClick={persistDraft}
                disabled={saving || !hasPermission("purchase_bill:create")}
              >
                {saving ? "Saving..." : "Save Draft"}
              </Button>
              <Button
                variant="outline"
                onClick={() => void transitionBill("verify")}
                disabled={saving || draft.status === "VERIFIED" || draft.status === "POSTED" || !hasPermission("purchase_bill:verify")}
              >
                Verify
              </Button>
              <Button
                onClick={() => void transitionBill("post")}
                disabled={saving || draft.status !== "VERIFIED" || !hasPermission("purchase_bill:post")}
              >
                Post Bill
              </Button>
              <Button
                variant="ghost"
                onClick={() => void transitionBill("cancel")}
                disabled={saving || draft.status === "POSTED" || draft.status === "CANCELLED"}
              >
                Cancel
              </Button>
            </AppActionBar>
          </div>
        </div>
      ) : permissionLoading ? (
        <p className="text-sm text-muted-foreground">Loading permissions...</p>
      ) : (
        <AppSectionCard title="Review Workspace" description="Upload a purchase invoice to create a draft bill for review.">
          <p className="text-sm text-[hsl(var(--text-secondary))]">
            No purchase bill selected yet. Upload an invoice or choose an existing draft from the table above.
          </p>
        </AppSectionCard>
      )}
    </div>
  );
}
