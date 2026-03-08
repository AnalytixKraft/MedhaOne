"use client";

import { AlertTriangle } from "lucide-react";

import { ErpCombobox } from "@/components/ui/erp-combobox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const amountFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export type PurchaseOrderTaxOption = {
  label: string;
  value: string;
  tax_name: string;
  tax_percent: number;
};

type PurchaseOrderSummaryProps = {
  subtotal: number;
  discountPercentInput: string;
  onDiscountPercentChange: (value: string) => void;
  discountAmount: number;
  taxOptions: PurchaseOrderTaxOption[];
  selectedTaxRateId: string;
  onSelectedTaxRateIdChange: (value: string) => void;
  gstPercent: number;
  taxableValue: number;
  taxMode: "INTRA_STATE" | "INTER_STATE" | "UNDETERMINED";
  supplierGstin: string | null;
  supplierState: string | null;
  companyGstin: string | null;
  companyState: string | null;
  cgstPercent: number;
  sgstPercent: number;
  igstPercent: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  adjustmentInput: string;
  onAdjustmentChange: (value: string) => void;
  adjustmentAmount: number;
  total: number;
  validationMessage?: string | null;
  warningMessage?: string | null;
};

function TaxModeBadge({
  mode,
}: {
  mode: PurchaseOrderSummaryProps["taxMode"];
}) {
  const label =
    mode === "INTRA_STATE"
      ? "Intra-state"
      : mode === "INTER_STATE"
        ? "Inter-state"
        : "Undetermined";

  return (
    <span
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold uppercase tracking-[0.14em]",
        mode === "INTRA_STATE" &&
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
        mode === "INTER_STATE" &&
          "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300",
        mode === "UNDETERMINED" &&
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300",
      )}
      data-testid="po-tax-mode-badge"
    >
      {label}
    </span>
  );
}

function SummaryRow({
  label,
  value,
  accentClassName,
}: {
  label: string;
  value: string;
  accentClassName?: string;
}) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)_120px] items-center gap-3">
      <span className="text-sm font-medium text-[hsl(var(--text-primary))]">{label}</span>
      <div />
      <span
        className={cn(
          "text-right text-sm font-medium tabular-nums text-[hsl(var(--text-primary))]",
          accentClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function PurchaseOrderSummary({
  subtotal,
  discountPercentInput,
  onDiscountPercentChange,
  discountAmount,
  taxOptions,
  selectedTaxRateId,
  onSelectedTaxRateIdChange,
  gstPercent,
  taxableValue,
  taxMode,
  supplierGstin,
  supplierState,
  companyGstin,
  companyState,
  cgstPercent,
  sgstPercent,
  igstPercent,
  cgstAmount,
  sgstAmount,
  igstAmount,
  adjustmentInput,
  onAdjustmentChange,
  adjustmentAmount,
  total,
  validationMessage,
  warningMessage,
}: PurchaseOrderSummaryProps) {
  const taxSplitLabel =
    taxMode === "INTRA_STATE"
      ? `CGST ${cgstPercent.toFixed(2)}% + SGST ${sgstPercent.toFixed(2)}%`
      : taxMode === "INTER_STATE"
        ? `IGST ${igstPercent.toFixed(2)}%`
        : gstPercent > 0
          ? "Waiting for GST state comparison"
          : "GST 0.00%";

  return (
    <div className="w-full rounded-2xl border border-border bg-[hsl(var(--card-bg))] p-5 shadow-sm">
      <div className="grid gap-4 border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--text-secondary))]">
              Tax Context
            </p>
            <p className="mt-1 text-lg font-semibold text-[hsl(var(--text-primary))]">
              Supplier vs Company GST
            </p>
          </div>
          <TaxModeBadge mode={taxMode} />
        </div>

        <div className="grid gap-3 rounded-2xl border border-border bg-[hsl(var(--muted-bg))]/55 p-4 sm:grid-cols-2">
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-[hsl(var(--text-primary))]">Supplier</p>
            <p className="text-[hsl(var(--text-secondary))]" data-testid="po-supplier-gstin">
              Supplier GSTIN: {supplierGstin ?? "Not configured"}
            </p>
            <p className="text-[hsl(var(--text-secondary))]" data-testid="po-supplier-state">
              Supplier State: {supplierState ?? "Unknown"}
            </p>
          </div>

          <div className="space-y-2 text-sm">
            <p className="font-semibold text-[hsl(var(--text-primary))]">Company</p>
            <p className="text-[hsl(var(--text-secondary))]" data-testid="po-company-gstin">
              Company GSTIN: {companyGstin ?? "Not configured"}
            </p>
            <p className="text-[hsl(var(--text-secondary))]" data-testid="po-company-state">
              Company State: {companyState ?? "Unknown"}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-white/85 p-4 text-sm text-[hsl(var(--text-primary))] dark:bg-slate-950/50">
          <p className="font-semibold">Tax Split</p>
          <p className="mt-1 text-[hsl(var(--text-secondary))]" data-testid="po-tax-split">
            {taxSplitLabel}
          </p>
        </div>

        {warningMessage ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
            <p>{warningMessage}</p>
          </div>
        ) : null}
      </div>

      <div className="mt-4 space-y-2.5">
        <SummaryRow
          label="Subtotal"
          value={amountFormatter.format(subtotal)}
        />

        <div className="grid grid-cols-[112px_minmax(0,1fr)_120px] items-center gap-3">
          <span className="text-sm font-medium text-[hsl(var(--text-primary))]">Discount</span>
          <div className="flex items-center gap-2">
            <Input
              value={discountPercentInput}
              onChange={(event) => onDiscountPercentChange(event.target.value)}
              inputMode="decimal"
              className="text-right"
              placeholder="0"
            />
            <span className="w-6 text-center text-sm font-semibold text-[hsl(var(--text-secondary))]">
              %
            </span>
          </div>
          <span className="text-right text-sm font-medium tabular-nums text-rose-600 dark:text-rose-300">
            -{amountFormatter.format(discountAmount)}
          </span>
        </div>

        <div className="grid grid-cols-[112px_minmax(0,1fr)_120px] items-center gap-3">
          <span className="text-sm font-medium text-[hsl(var(--text-primary))]">GST Rate</span>
          <ErpCombobox
            data-testid="po-tax-select"
            className="min-w-[180px]"
            options={taxOptions}
            value={selectedTaxRateId}
            onValueChange={onSelectedTaxRateIdChange}
            placeholder="Select GST slab"
            searchPlaceholder="Search GST slab"
            emptyMessage="No tax master entries"
            triggerClassName="h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-none focus-visible:border-primary/40 focus-visible:ring-primary/20"
          />
          <span className="text-right text-sm font-medium tabular-nums text-[hsl(var(--text-primary))]">
            {gstPercent.toFixed(2)}%
          </span>
        </div>

        <SummaryRow
          label="Taxable Value"
          value={amountFormatter.format(taxableValue)}
        />
        <SummaryRow
          label={`CGST ${cgstPercent.toFixed(2)}%`}
          value={amountFormatter.format(cgstAmount)}
        />
        <SummaryRow
          label={`SGST ${sgstPercent.toFixed(2)}%`}
          value={amountFormatter.format(sgstAmount)}
        />
        <SummaryRow
          label={`IGST ${igstPercent.toFixed(2)}%`}
          value={amountFormatter.format(igstAmount)}
        />

        <div className="grid grid-cols-[112px_minmax(0,1fr)_120px] items-center gap-3">
          <span className="text-sm font-medium text-[hsl(var(--text-primary))]">Adjustment</span>
          <Input
            value={adjustmentInput}
            onChange={(event) => onAdjustmentChange(event.target.value)}
            inputMode="decimal"
            className="text-right"
            placeholder="0.00"
          />
          <span className="text-right text-sm font-medium tabular-nums text-[hsl(var(--text-primary))]">
            {amountFormatter.format(adjustmentAmount)}
          </span>
        </div>
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <div className="grid grid-cols-[112px_minmax(0,1fr)_120px] items-center gap-3">
          <span className="text-base font-semibold text-[hsl(var(--text-primary))]">Final Total</span>
          <div />
          <span className="text-right text-2xl font-semibold tabular-nums text-[hsl(var(--text-primary))]" data-testid="po-final-total">
            {amountFormatter.format(total)}
          </span>
        </div>
      </div>

      {validationMessage ? (
        <p className="mt-3 text-right text-xs font-medium text-rose-600 dark:text-rose-300">
          {validationMessage}
        </p>
      ) : null}
    </div>
  );
}
