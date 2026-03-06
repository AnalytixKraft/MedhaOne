"use client";

import { ErpCombobox } from "@/components/ui/erp-combobox";
import { Input } from "@/components/ui/input";
import type { PurchaseTaxType } from "@/lib/api/client";
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
  taxType: PurchaseTaxType;
  onTaxTypeChange: (value: PurchaseTaxType) => void;
  taxOptions: PurchaseOrderTaxOption[];
  selectedTaxName: string;
  onSelectedTaxNameChange: (value: string) => void;
  taxAmount: number;
  adjustmentInput: string;
  onAdjustmentChange: (value: string) => void;
  adjustmentAmount: number;
  total: number;
  validationMessage?: string | null;
};

function formatSignedAmount(value: number, preferNegativeZero = false) {
  const normalized = Math.abs(value) < 0.000_001 ? 0 : value;

  if (normalized === 0 && preferNegativeZero) {
    return `-${amountFormatter.format(0)}`;
  }

  if (normalized < 0) {
    return `-${amountFormatter.format(Math.abs(normalized))}`;
  }

  return amountFormatter.format(normalized);
}

export function PurchaseOrderSummary({
  subtotal,
  discountPercentInput,
  onDiscountPercentChange,
  discountAmount,
  taxType,
  onTaxTypeChange,
  taxOptions,
  selectedTaxName,
  onSelectedTaxNameChange,
  taxAmount,
  adjustmentInput,
  onAdjustmentChange,
  adjustmentAmount,
  total,
  validationMessage,
}: PurchaseOrderSummaryProps) {
  return (
    <div className="ml-auto w-full max-w-[420px] rounded-[12px] border border-white/10 border-l-[3px] border-l-[#22C55E] bg-[linear-gradient(180deg,#020617,#020617)] p-5 shadow-[0_10px_30px_rgba(0,0,0,0.42)]">
      <div className="space-y-2.5">
        <div className="grid grid-cols-[88px_minmax(0,1fr)_108px] items-center gap-3">
          <span className="text-sm font-medium text-[#e5e7eb]">Sub Total</span>
          <div />
          <span className="text-right text-base font-semibold tabular-nums text-[#f9fafb]">
            {amountFormatter.format(subtotal)}
          </span>
        </div>

        <div className="grid grid-cols-[88px_minmax(0,1fr)_108px] items-center gap-3">
          <span className="text-sm font-medium text-[#e5e7eb]">Discount</span>
          <div className="flex items-center gap-2">
            <Input
              value={discountPercentInput}
              onChange={(event) => onDiscountPercentChange(event.target.value)}
              inputMode="decimal"
              className="h-11 rounded-[10px] border-white/10 bg-[#020617] text-right text-sm text-[#f9fafb] shadow-none placeholder:text-[#9ca3af] transition-all duration-150 focus-visible:border-[#22C55E] focus-visible:ring-[#22C55E]/30 focus-visible:ring-offset-0"
              placeholder="0"
            />
            <span className="w-6 text-center text-sm font-semibold text-[#9ca3af]">
              %
            </span>
          </div>
          <span className="text-right text-sm font-medium tabular-nums text-rose-300">
            -{amountFormatter.format(discountAmount)}
          </span>
        </div>

        <div className="grid grid-cols-[88px_minmax(0,1fr)_108px] items-center gap-3">
          <span className="text-sm font-medium text-[#e5e7eb]">TDS / TCS</span>
          <div className="flex flex-wrap items-center gap-2">
            <fieldset className="flex items-center gap-2">
              <legend className="sr-only">Tax type</legend>
              {(["TDS", "TCS"] as PurchaseTaxType[]).map((option) => (
                <label key={option} className="cursor-pointer">
                  <input
                    type="radio"
                    name="po-tax-type"
                    value={option}
                    checked={taxType === option}
                    onChange={() => onTaxTypeChange(option)}
                    className="peer sr-only"
                  />
                  <span
                    className={cn(
                      "flex h-12 min-w-[68px] items-center justify-center rounded-[10px] border px-3 text-sm font-semibold transition-all duration-150",
                      "border-white/10 bg-[#020617] text-[#9ca3af] peer-focus-visible:ring-2 peer-focus-visible:ring-[#22C55E]/30 peer-focus-visible:ring-offset-0",
                      taxType === option &&
                        "border-[#22C55E]/70 bg-[#22C55E]/15 text-[#dcfce7]",
                    )}
                  >
                    {option}
                  </span>
                </label>
              ))}
            </fieldset>

            <ErpCombobox
              data-testid="po-tax-select"
              className="min-w-[160px] flex-1"
              options={taxOptions}
              value={selectedTaxName}
              onValueChange={onSelectedTaxNameChange}
              placeholder="Select Tax"
              searchPlaceholder="Search tax slab"
              emptyMessage="No tax master entries"
              triggerClassName="h-11 rounded-[10px] border-white/10 bg-[#020617] px-3 text-sm text-[#f9fafb] shadow-none focus-visible:border-[#22C55E] focus-visible:ring-[#22C55E]/30"
            />
          </div>
          <span
            className={cn(
              "text-right text-sm font-medium tabular-nums",
              taxType === "TDS" ? "text-rose-300" : "text-emerald-300",
            )}
          >
            {formatSignedAmount(taxAmount, taxType === "TDS")}
          </span>
        </div>

        <div className="grid grid-cols-[88px_minmax(0,1fr)_108px] items-center gap-3">
          <span className="text-sm font-medium text-[#e5e7eb]">Adjustment</span>
          <Input
            value={adjustmentInput}
            onChange={(event) => onAdjustmentChange(event.target.value)}
            inputMode="decimal"
            className="h-11 rounded-[10px] border-white/10 bg-[#020617] text-right text-sm text-[#f9fafb] shadow-none placeholder:text-[#9ca3af] transition-all duration-150 focus-visible:border-[#22C55E] focus-visible:ring-[#22C55E]/30 focus-visible:ring-offset-0"
            placeholder="0.00"
          />
          <span className="text-right text-sm font-medium tabular-nums text-[#e5e7eb]">
            {formatSignedAmount(adjustmentAmount)}
          </span>
        </div>
      </div>

      <div className="mt-3 border-t border-white/10 pt-3">
        <div className="grid grid-cols-[88px_minmax(0,1fr)_108px] items-center gap-3">
          <span className="text-base font-semibold text-white">Total</span>
          <div />
          <span className="text-right text-2xl font-semibold tabular-nums text-white">
            {amountFormatter.format(total)}
          </span>
        </div>
      </div>

      {validationMessage ? (
        <p className="mt-3 text-right text-xs font-medium text-rose-300">
          {validationMessage}
        </p>
      ) : null}
    </div>
  );
}
