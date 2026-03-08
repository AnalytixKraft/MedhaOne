"use client";

import { memo, useMemo } from "react";
import { Copy, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErpCombobox } from "@/components/ui/erp-combobox";
import { Input } from "@/components/ui/input";
import { QuantityInput } from "@/components/ui/quantity-input";
import { cn } from "@/lib/utils";
import { Product } from "@/lib/api/client";
import {
  normalizeQuantityInput,
  normalizeQuantityPrecision,
} from "@/lib/quantity";

export const PURCHASE_LINE_GRID_TEMPLATE =
  "320px 140px 140px 120px 160px 120px 140px 160px 80px";
export const PURCHASE_LINE_GRID_MIN_WIDTH = "1380px";
const UNIT_COST_INPUT_PATTERN = /^\d*(?:\.\d{0,2})?$/;

export type PurchaseGridField =
  | "item"
  | "batch"
  | "expiry"
  | "ordered_qty"
  | "unit_cost";

export type PurchaseLineDraft = {
  id: string;
  product_id: string;
  product_query: string;
  batch: string;
  expiry: string;
  ordered_qty: string;
  unit_cost: string;
  free_qty: string;
};

type PurchaseLineRowProps = {
  row: PurchaseLineDraft;
  rowIndex: number;
  products: Product[];
  isOdd: boolean;
  onUpdateLine: (lineId: string, patch: Partial<PurchaseLineDraft>) => void;
  onRemoveLine: (lineId: string) => void;
  onDuplicateLine: (line: PurchaseLineDraft) => void;
  onCellKeyDown: (
    rowIndex: number,
    field: PurchaseGridField,
    event: React.KeyboardEvent<HTMLElement>,
  ) => void;
  registerCell: (
    rowId: string,
    field: PurchaseGridField,
    element: HTMLElement | null,
  ) => void;
  rowTotalDisplay: string;
  canRemove: boolean;
};

type ProductComboboxProps = {
  row: PurchaseLineDraft;
  rowIndex: number;
  products: Product[];
  onUpdateLine: (lineId: string, patch: Partial<PurchaseLineDraft>) => void;
  onCellKeyDown: (
    rowIndex: number,
    field: PurchaseGridField,
    event: React.KeyboardEvent<HTMLElement>,
  ) => void;
  registerCell: (
    rowId: string,
    field: PurchaseGridField,
    element: HTMLElement | null,
  ) => void;
};

function formatGstRate(rate: string | null | undefined) {
  if (!rate) {
    return "0.00%";
  }

  const parsed = Number.parseFloat(rate);
  if (!Number.isFinite(parsed)) {
    return "0.00%";
  }

  return `${parsed.toFixed(2)}%`;
}

const purchaseCellInputClassName =
  "h-11 rounded-xl border border-input bg-background text-foreground shadow-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-0";

const purchaseReadOnlyCellClassName =
  "flex h-11 w-full items-center rounded-xl border border-input bg-[hsl(var(--muted-bg))] px-3 text-sm text-[hsl(var(--text-primary))]";

function ProductCombobox({
  row,
  rowIndex,
  products,
  onUpdateLine,
  onCellKeyDown,
  registerCell,
}: ProductComboboxProps) {
  const productsById = useMemo(
    () =>
      new Map(products.map((product) => [String(product.id), product] as const)),
    [products],
  );

  const productOptions = useMemo(
    () =>
      products.map((product) => ({
        label: `${product.sku} - ${product.name}`,
        value: String(product.id),
      })),
    [products],
  );

  return (
    <ErpCombobox
      ref={(element) => registerCell(row.id, "item", element)}
      data-testid={`po-line-product-${rowIndex}`}
      options={productOptions}
      value={row.product_id}
      displayValue={row.product_query}
      onValueChange={(productId) => {
        const selectedProductOption = productOptions.find(
          (option) => option.value === productId,
        );
        const nextProduct = productsById.get(productId);
        const nextPrecision = normalizeQuantityPrecision(
          nextProduct?.quantity_precision,
        );

        onUpdateLine(row.id, {
          product_id: productId,
          product_query: selectedProductOption?.label ?? "",
          ordered_qty: row.ordered_qty
            ? normalizeQuantityInput(row.ordered_qty, nextPrecision)
            : row.ordered_qty,
        });
      }}
      onQueryChange={(query) => {
        const normalizedQuery = query.trim();
        const selectedProductOption = productOptions.find(
          (option) => option.value === row.product_id,
        );

        onUpdateLine(row.id, {
          product_id:
            selectedProductOption && selectedProductOption.label === normalizedQuery
              ? row.product_id
              : "",
          product_query: query,
        });
      }}
      onTriggerKeyDown={(event) => {
        if (
          event.key === "Escape" ||
          event.key === "ArrowDown" ||
          event.key === "ArrowUp"
        ) {
          onCellKeyDown(rowIndex, "item", event);
        }
      }}
      placeholder="Search item by SKU or name"
      searchPlaceholder="Type SKU or product name"
      emptyMessage="No matching items"
      triggerClassName={purchaseCellInputClassName}
      panelClassName="z-[260]"
      renderOption={(option) => {
        const product = productsById.get(option.value);

        return (
          <span className="flex items-center justify-between gap-3">
            <span className="truncate">{option.label}</span>
            <span className="shrink-0 text-xs uppercase tracking-[0.14em] text-[#9ca3af]">
              {product?.uom}
              {product ? ` · ${product.quantity_precision}dp` : ""}
            </span>
          </span>
        );
      }}
    />
  );
}

export const PurchaseLineRow = memo(function PurchaseLineRow({
  row,
  rowIndex,
  products,
  isOdd,
  onUpdateLine,
  onRemoveLine,
  onDuplicateLine,
  onCellKeyDown,
  registerCell,
  rowTotalDisplay,
  canRemove,
}: PurchaseLineRowProps) {
  const selectedProduct = useMemo(
    () => products.find((product) => String(product.id) === row.product_id) ?? null,
    [products, row.product_id],
  );
  const quantityPrecision = normalizeQuantityPrecision(
    selectedProduct?.quantity_precision,
  );
  const gstRateDisplay = formatGstRate(selectedProduct?.gst_rate);
  const hsnDisplay = selectedProduct?.hsn?.trim() || "—";

  return (
    <div
      className={cn(
        "grid min-h-[56px] items-center border-b border-border text-sm transition-colors duration-150 hover:bg-[hsl(var(--table-row-hover))] focus-within:bg-[hsl(var(--table-row-hover))]",
        isOdd ? "bg-[hsl(var(--muted-bg))]/60" : "bg-[hsl(var(--card-bg))]",
      )}
      style={{
        gridTemplateColumns: PURCHASE_LINE_GRID_TEMPLATE,
        minWidth: PURCHASE_LINE_GRID_MIN_WIDTH,
      }}
    >
      <div className="flex min-h-[56px] items-center px-3.5 py-2">
        <ProductCombobox
          row={row}
          rowIndex={rowIndex}
          products={products}
          onUpdateLine={onUpdateLine}
          onCellKeyDown={onCellKeyDown}
          registerCell={registerCell}
        />
      </div>

      <div className="flex min-h-[56px] items-center px-3.5 py-2">
        <Input
          ref={(element) => registerCell(row.id, "batch", element)}
          value={row.batch}
          onChange={(event) => onUpdateLine(row.id, { batch: event.target.value })}
          onKeyDown={(event) => onCellKeyDown(rowIndex, "batch", event)}
          placeholder="Optional"
          className={purchaseCellInputClassName}
        />
      </div>

      <div className="flex min-h-[56px] items-center px-3.5 py-2">
        <Input
          ref={(element) => registerCell(row.id, "expiry", element)}
          type="date"
          value={row.expiry}
          onChange={(event) => onUpdateLine(row.id, { expiry: event.target.value })}
          onKeyDown={(event) => onCellKeyDown(rowIndex, "expiry", event)}
          className={purchaseCellInputClassName}
        />
      </div>

      <div className="flex min-h-[56px] items-center px-3.5 py-2">
        <QuantityInput
          ref={(element) => registerCell(row.id, "ordered_qty", element)}
          data-testid={`po-line-qty-${rowIndex}`}
          precision={quantityPrecision}
          min="0"
          value={row.ordered_qty}
          onValueChange={(value) => onUpdateLine(row.id, { ordered_qty: value })}
          onKeyDown={(event) => onCellKeyDown(rowIndex, "ordered_qty", event)}
          className={cn(purchaseCellInputClassName, "text-right tabular-nums")}
        />
      </div>

      <div className="flex min-h-[56px] items-center px-3.5 py-2">
        <Input
          ref={(element) => registerCell(row.id, "unit_cost", element)}
          data-testid={`po-line-cost-${rowIndex}`}
          type="number"
          step="1"
          min="0"
          inputMode="decimal"
          value={row.unit_cost}
          onChange={(event) => {
            const nextValue = event.target.value;
            if (!nextValue || UNIT_COST_INPUT_PATTERN.test(nextValue)) {
              onUpdateLine(row.id, { unit_cost: nextValue });
            }
          }}
          onBlur={(event) => {
            const normalized = event.currentTarget.value.trim();
            if (!normalized) {
              return;
            }

            const parsed = Number.parseFloat(normalized);
            if (!Number.isFinite(parsed)) {
              return;
            }

            onUpdateLine(row.id, { unit_cost: parsed.toFixed(2) });
          }}
          onKeyDown={(event) => onCellKeyDown(rowIndex, "unit_cost", event)}
          placeholder="0.00"
          className={cn(purchaseCellInputClassName, "text-right tabular-nums")}
        />
      </div>

      <div className="flex min-h-[56px] items-center px-3.5 py-2">
        <div className={cn(purchaseReadOnlyCellClassName, "text-right tabular-nums")}>
          <span className="ml-auto">{gstRateDisplay}</span>
        </div>
      </div>

      <div className="flex min-h-[56px] items-center px-3.5 py-2">
        <div className={purchaseReadOnlyCellClassName}>
          <span className="truncate">{hsnDisplay}</span>
        </div>
      </div>

      <div className="flex min-h-[56px] items-center px-3.5 py-2">
        <div className={cn(purchaseReadOnlyCellClassName, "text-right font-semibold tabular-nums")}>
          <span className="ml-auto">{rowTotalDisplay}</span>
        </div>
      </div>

      <div className="flex min-h-[56px] items-center justify-center gap-1 px-1 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onDuplicateLine(row)}
          aria-label={`Duplicate line ${rowIndex + 1}`}
          className="h-8 w-8 rounded-md text-muted-foreground transition-colors duration-150 hover:bg-[hsl(var(--muted-bg))] hover:text-foreground"
        >
          <Copy className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onRemoveLine(row.id)}
          aria-label={`Delete line ${rowIndex + 1}`}
          className="h-8 w-8 rounded-md text-rose-600 transition-colors duration-150 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
          disabled={!canRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
});
