"use client";

import { useCallback, useEffect, useRef } from "react";

import { Product } from "@/lib/api/client";

import {
  PurchaseGridField,
  PURCHASE_LINE_GRID_MIN_WIDTH,
  PURCHASE_LINE_GRID_TEMPLATE,
  PurchaseLineDraft,
  PurchaseLineRow,
} from "@/components/purchase/purchase-line-row";

const FIELD_ORDER: PurchaseGridField[] = [
  "item",
  "batch",
  "expiry",
  "ordered_qty",
  "unit_cost",
];

type PurchaseLineGridProps = {
  rows: PurchaseLineDraft[];
  products: Product[];
  onUpdateLine: (lineId: string, patch: Partial<PurchaseLineDraft>) => void;
  onAddLine: () => string;
  onRemoveLine: (lineId: string) => void;
  onDuplicateLine: (line: PurchaseLineDraft) => string;
  formatAmount: (value: number) => string;
};

export function PurchaseLineGrid({
  rows,
  products,
  onUpdateLine,
  onAddLine,
  onRemoveLine,
  onDuplicateLine,
  formatAmount,
}: PurchaseLineGridProps) {
  const cellRefs = useRef<Record<string, HTMLElement | null>>({});
  const rowsRef = useRef(rows);
  const pendingFocus = useRef<{ rowId: string; field: PurchaseGridField } | null>(
    null,
  );

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const registerCell = useCallback(
    (rowId: string, field: PurchaseGridField, element: HTMLElement | null) => {
      cellRefs.current[`${rowId}:${field}`] = element;
    },
    [],
  );

  const focusCell = useCallback((rowId: string, field: PurchaseGridField) => {
    const cell = cellRefs.current[`${rowId}:${field}`];
    cell?.focus();
  }, []);

  useEffect(() => {
    if (!pendingFocus.current) {
      return;
    }

    const nextFocus = pendingFocus.current;
    pendingFocus.current = null;
    focusCell(nextFocus.rowId, nextFocus.field);
  }, [focusCell, rows]);

  const focusRowByIndex = useCallback(
    (rowIndex: number, field: PurchaseGridField) => {
      const targetRow = rowsRef.current[rowIndex];
      if (!targetRow) {
        return;
      }
      focusCell(targetRow.id, field);
    },
    [focusCell],
  );

  const moveForward = useCallback(
    (rowIndex: number, field: PurchaseGridField) => {
      if (field === "unit_cost") {
        const nextRow = rowsRef.current[rowIndex + 1];
        if (nextRow) {
          focusCell(nextRow.id, "item");
          return;
        }

        const newRowId = onAddLine();
        pendingFocus.current = { rowId: newRowId, field: "item" };
        return;
      }

      const nextField = FIELD_ORDER[FIELD_ORDER.indexOf(field) + 1];
      if (nextField) {
        focusRowByIndex(rowIndex, nextField);
      }
    },
    [focusCell, focusRowByIndex, onAddLine],
  );

  const handleCellKeyDown = useCallback(
    (
      rowIndex: number,
      field: PurchaseGridField,
      event: React.KeyboardEvent<HTMLElement>,
    ) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.currentTarget.blur();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusRowByIndex(Math.min(rowIndex + 1, rowsRef.current.length - 1), field);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        focusRowByIndex(Math.max(rowIndex - 1, 0), field);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        moveForward(rowIndex, field);
      }
    },
    [focusRowByIndex, moveForward],
  );

  const handleDuplicateLine = useCallback(
    (line: PurchaseLineDraft) => {
      const duplicatedId = onDuplicateLine(line);
      pendingFocus.current = { rowId: duplicatedId, field: "item" };
    },
    [onDuplicateLine],
  );

  return (
    <div className="relative min-h-[280px] w-full rounded-[12px] border border-white/10 bg-[linear-gradient(180deg,#111827,#0f172a)] p-0 shadow-[0_10px_30px_rgba(0,0,0,0.42)]">
      <div className="overflow-x-auto">
        <div style={{ minWidth: PURCHASE_LINE_GRID_MIN_WIDTH }}>
          <div className="max-h-[620px] min-h-[224px] overflow-y-auto">
            <div
              className="sticky top-0 z-20 grid border-b border-white/10 bg-[#0f172a] text-[12px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]"
              style={{ gridTemplateColumns: PURCHASE_LINE_GRID_TEMPLATE }}
            >
              <div className="px-3.5 py-3">Item</div>
              <div className="px-3.5 py-3">Batch</div>
              <div className="px-3.5 py-3">Expiry</div>
              <div className="px-3.5 py-3 text-right">Qty</div>
              <div className="px-3.5 py-3 text-right">Unit Cost</div>
              <div className="px-3.5 py-3 text-right">GST Rate</div>
              <div className="px-3.5 py-3">HSN Code</div>
              <div className="px-3.5 py-3 text-right">Total</div>
              <div className="px-3.5 py-3 text-center">Action</div>
            </div>

            {rows.length === 0 ? (
              <div
                className="grid h-14 items-center border-b border-white/10 text-sm text-[#9ca3af]"
                style={{ gridTemplateColumns: PURCHASE_LINE_GRID_TEMPLATE }}
              >
                <div className="px-3.5">No line items yet</div>
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
                <div />
              </div>
            ) : (
              rows.map((row, index) => {
                const quantity = Number.parseFloat(row.ordered_qty || "0");
                const unitCost = Number.parseFloat(row.unit_cost || "0");
                const rowTotal =
                  (Number.isFinite(quantity) ? quantity : 0) *
                  (Number.isFinite(unitCost) ? unitCost : 0);

                return (
                  <PurchaseLineRow
                    key={row.id}
                    row={row}
                    rowIndex={index}
                    products={products}
                    isOdd={index % 2 === 1}
                    onUpdateLine={onUpdateLine}
                    onRemoveLine={onRemoveLine}
                    onDuplicateLine={handleDuplicateLine}
                    onCellKeyDown={handleCellKeyDown}
                    registerCell={registerCell}
                    rowTotalDisplay={formatAmount(rowTotal)}
                    canRemove={rows.length > 1}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
