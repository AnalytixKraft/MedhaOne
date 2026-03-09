"use client";

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
  taxableValue: number;
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
}

function SummaryRow({
  label,
  value,
  accentClassName,
  testId,
}: {
  label: string;
  value: string;
  accentClassName?: string;
  testId?: string;
}) {
  return (
    <div
      className="grid grid-cols-[112px_minmax(0,1fr)_120px] items-center gap-3"
      data-testid={testId}
    >
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
  taxableValue,
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
  return (
    <div className="w-full rounded-2xl border border-border bg-[hsl(var(--card-bg))] p-5 shadow-sm">
      {warningMessage ? (
        <div
          className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
          data-testid="po-tax-warning"
        >
          <p>{warningMessage}</p>
        </div>
      ) : null}

      <div className="space-y-2.5">
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

        <SummaryRow
          label="Taxable Value"
          value={amountFormatter.format(taxableValue)}
          testId="po-summary-taxable-value"
        />
        <SummaryRow
          label="CGST"
          value={amountFormatter.format(cgstAmount)}
          testId="po-summary-cgst"
        />
        <SummaryRow
          label="SGST"
          value={amountFormatter.format(sgstAmount)}
          testId="po-summary-sgst"
        />
        <SummaryRow
          label="IGST"
          value={amountFormatter.format(igstAmount)}
          testId="po-summary-igst"
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
        <p
          className="mt-3 text-right text-xs font-medium text-rose-600 dark:text-rose-300"
          data-testid="po-tax-validation"
        >
          {validationMessage}
        </p>
      ) : null}
    </div>
  );
}
