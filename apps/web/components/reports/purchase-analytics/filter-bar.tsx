"use client";

import { Check, ChevronDown, Download, Printer, Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { FilterCard } from "@/components/erp/app-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PurchaseAnalyticsFilterOptions } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type FilterOption = {
  label: string;
  value: string;
};

export type PurchaseAnalyticsFilterState = {
  productIds: string[];
  brandValues: string[];
  categoryValues: string[];
  supplierIds: string[];
  warehouseIds: string[];
  dateFrom: string;
  dateTo: string;
  year: string;
  month: string;
};

export const defaultPurchaseAnalyticsFilters: PurchaseAnalyticsFilterState = {
  productIds: [],
  brandValues: [],
  categoryValues: [],
  supplierIds: [],
  warehouseIds: [],
  dateFrom: "",
  dateTo: "",
  year: "",
  month: "",
};

const monthOptions = [
  { label: "January", value: "1" },
  { label: "February", value: "2" },
  { label: "March", value: "3" },
  { label: "April", value: "4" },
  { label: "May", value: "5" },
  { label: "June", value: "6" },
  { label: "July", value: "7" },
  { label: "August", value: "8" },
  { label: "September", value: "9" },
  { label: "October", value: "10" },
  { label: "November", value: "11" },
  { label: "December", value: "12" },
];

function MultiSelectFilter({
  label,
  options,
  values,
  onChange,
}: {
  label: string;
  options: FilterOption[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  const filteredOptions = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    if (!normalized) {
      return options;
    }
    return options.filter((option) => option.label.toLowerCase().includes(normalized));
  }, [deferredQuery, options]);

  const selectedSet = useMemo(() => new Set(values), [values]);

  return (
    <div ref={rootRef} className="relative">
      <p className="mb-1.5 text-xs font-semibold text-[hsl(var(--text-secondary))]">{label}</p>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 w-full items-center justify-between rounded-xl border border-border bg-[hsl(var(--surface-elevated))] px-3 text-left text-sm text-[hsl(var(--text-primary))] shadow-sm transition-colors hover:bg-[hsl(var(--surface-muted))]"
      >
        <span className="truncate">
          {values.length > 0 ? `${values.length} selected` : `All ${label.toLowerCase()}`}
        </span>
        <ChevronDown className="h-4 w-4 opacity-70" />
      </button>

      {open ? (
        <div className="absolute z-50 mt-2 w-full min-w-[280px] rounded-2xl border border-border bg-[hsl(var(--surface-elevated))] p-3 shadow-xl">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${label.toLowerCase()}`}
              className="h-10 rounded-xl border-border bg-background pl-8"
            />
          </div>

          <div className="mb-2 flex justify-end">
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])} className="h-8 px-2 text-xs">
              Clear
            </Button>
          </div>

          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {filteredOptions.map((option) => {
              const checked = selectedSet.has(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    if (checked) {
                      onChange(values.filter((value) => value !== option.value));
                    } else {
                      onChange([...values, option.value]);
                    }
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm text-[hsl(var(--text-primary))] transition-colors",
                    checked ? "bg-primary/12 text-primary" : "hover:bg-[hsl(var(--hover))]",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded border border-border",
                      checked && "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {checked ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
            {filteredOptions.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">No options found.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-[hsl(var(--text-secondary))]">{label}</p>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-border bg-[hsl(var(--surface-elevated))] px-3 text-sm text-[hsl(var(--text-primary))] shadow-sm"
      >
        <option value="">All {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PurchaseAnalyticsFilterBar({
  options,
  value,
  onChange,
  onApply,
  onClear,
  onExportCsv,
  onExportExcel,
  onPrint,
  showYearFilter = false,
  showMonthFilter = false,
}: {
  options: PurchaseAnalyticsFilterOptions;
  value: PurchaseAnalyticsFilterState;
  onChange: (next: PurchaseAnalyticsFilterState) => void;
  onApply: () => void;
  onClear: () => void;
  onExportCsv: () => void;
  onExportExcel: () => void;
  onPrint: () => void;
  showYearFilter?: boolean;
  showMonthFilter?: boolean;
}) {
  const brandOptions = useMemo(
    () => options.brands.map((entry) => ({ label: entry, value: entry })),
    [options.brands],
  );
  const categoryOptions = useMemo(
    () => options.categories.map((entry) => ({ label: entry, value: entry })),
    [options.categories],
  );
  const productOptions = useMemo(
    () => options.products.map((entry) => ({ label: entry.label, value: String(entry.id) })),
    [options.products],
  );
  const supplierOptions = useMemo(
    () => options.suppliers.map((entry) => ({ label: entry.label, value: String(entry.id) })),
    [options.suppliers],
  );
  const warehouseOptions = useMemo(
    () => options.warehouses.map((entry) => ({ label: entry.label, value: String(entry.id) })),
    [options.warehouses],
  );
  const yearOptions = useMemo(
    () => options.years.map((entry) => ({ label: String(entry), value: String(entry) })),
    [options.years],
  );

  const updateField = <T extends keyof PurchaseAnalyticsFilterState>(
    key: T,
    fieldValue: PurchaseAnalyticsFilterState[T],
  ) => {
    onChange({ ...value, [key]: fieldValue });
  };

  return (
    <FilterCard
      title="Purchase Analytics Filters"
      description="Refine procurement analytics by item, supplier, warehouse, and time window."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={onExportCsv}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button type="button" variant="outline" onClick={onExportExcel}>
            <Download className="mr-2 h-4 w-4" />
            Export Excel
          </Button>
          <Button type="button" variant="outline" onClick={onPrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MultiSelectFilter label="Product" options={productOptions} values={value.productIds} onChange={(next) => updateField("productIds", next)} />
        <MultiSelectFilter label="Brand" options={brandOptions} values={value.brandValues} onChange={(next) => updateField("brandValues", next)} />
        <MultiSelectFilter label="Category" options={categoryOptions} values={value.categoryValues} onChange={(next) => updateField("categoryValues", next)} />
        <MultiSelectFilter label="Supplier" options={supplierOptions} values={value.supplierIds} onChange={(next) => updateField("supplierIds", next)} />
        <MultiSelectFilter label="Warehouse" options={warehouseOptions} values={value.warehouseIds} onChange={(next) => updateField("warehouseIds", next)} />
        <div>
          <p className="mb-1.5 text-xs font-semibold text-[hsl(var(--text-secondary))]">Date From</p>
          <Input type="date" value={value.dateFrom} onChange={(event) => updateField("dateFrom", event.target.value)} className="h-11 rounded-xl" />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-[hsl(var(--text-secondary))]">Date To</p>
          <Input type="date" value={value.dateTo} onChange={(event) => updateField("dateTo", event.target.value)} className="h-11 rounded-xl" />
        </div>
        {showYearFilter ? (
          <SelectField label="Year" value={value.year} options={yearOptions} onChange={(next) => updateField("year", next)} />
        ) : null}
        {showMonthFilter ? (
          <SelectField label="Month" value={value.month} options={monthOptions} onChange={(next) => updateField("month", next)} />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClear}>
          <X className="mr-2 h-4 w-4" />
          Clear Filters
        </Button>
        <Button type="button" onClick={onApply}>
          Apply Filters
        </Button>
      </div>
    </FilterCard>
  );
}
