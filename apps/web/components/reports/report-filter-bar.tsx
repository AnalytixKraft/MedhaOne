"use client";

import { Check, ChevronDown, Funnel, Search, SlidersHorizontal, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { FilterCard } from "@/components/erp/app-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReportFilterOptions } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type FilterOption = {
  label: string;
  value: string;
};

export type ReportFilterState = {
  brandValues: string[];
  productIds: string[];
  supplierIds: string[];
  warehouseIds: string[];
  categoryValues: string[];
  batchNos: string[];
  dateFrom: string;
  dateTo: string;
  expiryStatus: "all" | "expiring_30" | "expired" | "safe";
  stockStatus: "all" | "available" | "zero" | "negative";
  stockSource: "all" | "opening" | "non_opening";
};

export const defaultReportFilters: ReportFilterState = {
  brandValues: [],
  productIds: [],
  supplierIds: [],
  warehouseIds: [],
  categoryValues: [],
  batchNos: [],
  dateFrom: "",
  dateTo: "",
  expiryStatus: "all",
  stockStatus: "all",
  stockSource: "all",
};

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
    return options.filter((option) =>
      option.label.toLowerCase().includes(normalized),
    );
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
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange([])}
              className="h-8 px-2 text-xs"
            >
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
                    checked
                      ? "bg-primary/12 text-primary"
                      : "hover:bg-[hsl(var(--hover))]",
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

export function ReportFilterBar({
  options,
  value,
  onChange,
  onApply,
  onClear,
  showStockStatus = false,
  showStockSource = false,
}: {
  options: ReportFilterOptions;
  value: ReportFilterState;
  onChange: (next: ReportFilterState) => void;
  onApply: () => void;
  onClear: () => void;
  showStockStatus?: boolean;
  showStockSource?: boolean;
}) {
  const brandOptions = useMemo(
    () => options.brands.map((entry) => ({ label: entry, value: entry })),
    [options.brands],
  );
  const categoryOptions = useMemo(
    () => options.categories.map((entry) => ({ label: entry, value: entry })),
    [options.categories],
  );
  const batchOptions = useMemo(
    () => options.batches.map((entry) => ({ label: entry, value: entry })),
    [options.batches],
  );
  const productOptions = useMemo(
    () =>
      options.products.map((entry) => ({
        label: entry.label,
        value: String(entry.id),
      })),
    [options.products],
  );
  const supplierOptions = useMemo(
    () =>
      options.suppliers.map((entry) => ({
        label: entry.label,
        value: String(entry.id),
      })),
    [options.suppliers],
  );
  const warehouseOptions = useMemo(
    () =>
      options.warehouses.map((entry) => ({
        label: entry.label,
        value: String(entry.id),
      })),
    [options.warehouses],
  );

  const updateField = <T extends keyof ReportFilterState>(
    key: T,
    fieldValue: ReportFilterState[T],
  ) => {
    onChange({ ...value, [key]: fieldValue });
  };

  const hasAdvancedFilters =
    value.brandValues.length > 0 ||
    value.categoryValues.length > 0 ||
    value.batchNos.length > 0 ||
    value.stockStatus !== "all" ||
    value.stockSource !== "all";
  const [showAdvanced, setShowAdvanced] = useState(hasAdvancedFilters);

  useEffect(() => {
    if (hasAdvancedFilters) {
      setShowAdvanced(true);
    }
  }, [hasAdvancedFilters]);

  const secondaryFieldClass =
    "h-11 w-full rounded-xl border border-border bg-[hsl(var(--surface-elevated))] px-3 text-sm text-[hsl(var(--text-primary))] shadow-sm outline-none ring-offset-background transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1";

  return (
    <FilterCard
      title="Report Filters"
      description="Refine report output by stock bucket, supplier, warehouse, and date range."
      actions={
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-center gap-2 rounded-xl border border-border/70 px-3 lg:w-auto"
          onClick={() => setShowAdvanced((current) => !current)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {showAdvanced ? "Hide Advanced Filters" : "Show Advanced Filters"}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <MultiSelectFilter
          label="Warehouse"
          options={warehouseOptions}
          values={value.warehouseIds}
          onChange={(next) => updateField("warehouseIds", next)}
        />
        <MultiSelectFilter
          label="Product"
          options={productOptions}
          values={value.productIds}
          onChange={(next) => updateField("productIds", next)}
        />
        <MultiSelectFilter
          label="Supplier"
          options={supplierOptions}
          values={value.supplierIds}
          onChange={(next) => updateField("supplierIds", next)}
        />
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-[hsl(var(--text-secondary))]">Date From</span>
          <Input
            type="date"
            value={value.dateFrom}
            onChange={(event) => updateField("dateFrom", event.target.value)}
            className={secondaryFieldClass}
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-[hsl(var(--text-secondary))]">Date To</span>
          <Input
            type="date"
            value={value.dateTo}
            onChange={(event) => updateField("dateTo", event.target.value)}
            className={secondaryFieldClass}
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-[hsl(var(--text-secondary))]">Expiry Status</span>
          <select
            value={value.expiryStatus}
            onChange={(event) =>
              updateField(
                "expiryStatus",
                event.target.value as ReportFilterState["expiryStatus"],
              )
            }
            className={secondaryFieldClass}
          >
            <option value="all">All</option>
            <option value="expiring_30">Expiring within 30 days</option>
            <option value="expired">Expired</option>
            <option value="safe">Safe stock</option>
          </select>
        </label>
      </div>

      {showAdvanced ? (
        <div className="mt-4 rounded-2xl border border-border/70 bg-[hsl(var(--surface-muted))] p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[hsl(var(--text-primary))]">
                Advanced Filters
              </p>
              <p className="text-xs text-[hsl(var(--text-secondary))]">
                Use batch and classification filters when you need a narrower report cut.
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <MultiSelectFilter
              label="Brand"
              options={brandOptions}
              values={value.brandValues}
              onChange={(next) => updateField("brandValues", next)}
            />
            <MultiSelectFilter
              label="Category"
              options={categoryOptions}
              values={value.categoryValues}
              onChange={(next) => updateField("categoryValues", next)}
            />
            <MultiSelectFilter
              label="Batch"
              options={batchOptions}
              values={value.batchNos}
              onChange={(next) => updateField("batchNos", next)}
            />
            {showStockStatus ? (
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-[hsl(var(--text-secondary))]">Stock Status</span>
                <select
                  value={value.stockStatus}
                  onChange={(event) =>
                    updateField(
                      "stockStatus",
                      event.target.value as ReportFilterState["stockStatus"],
                    )
                  }
                  className={secondaryFieldClass}
                >
                  <option value="all">All</option>
                  <option value="available">Available stock</option>
                  <option value="zero">Zero stock</option>
                  <option value="negative">Negative stock</option>
                </select>
              </label>
            ) : null}
            {showStockSource ? (
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-[hsl(var(--text-secondary))]">Stock Source</span>
                <select
                  value={value.stockSource}
                  onChange={(event) =>
                    updateField(
                      "stockSource",
                      event.target.value as ReportFilterState["stockSource"],
                    )
                  }
                  className={secondaryFieldClass}
                >
                  <option value="all">All stock</option>
                  <option value="opening">Opening stock only</option>
                  <option value="non_opening">Added after opening</option>
                </select>
              </label>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClear} className="gap-1 rounded-xl">
          <X className="h-4 w-4" />
          Clear Filters
        </Button>
        <Button type="button" onClick={onApply} className="gap-1 rounded-xl px-5">
          <Funnel className="h-4 w-4" />
          Apply Filters
        </Button>
      </div>
    </FilterCard>
  );
}
