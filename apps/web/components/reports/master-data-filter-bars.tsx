"use client";

import { Check, ChevronDown, Download, FileSpreadsheet, Printer, Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { FilterCard } from "@/components/erp/app-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DataQualityFilterOptions, MasterReportFilterOptions } from "@/lib/api/client";
import { cn } from "@/lib/utils";

type FilterOption = {
  label: string;
  value: string;
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
    return options.filter((option) => option.label.toLowerCase().includes(normalized));
  }, [deferredQuery, options]);

  const selectedSet = useMemo(() => new Set(values), [values]);

  return (
    <div ref={rootRef} className="relative">
      <p className="mb-1.5 text-xs font-semibold text-[hsl(var(--text-secondary))]">{label}</p>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-11 w-full items-center justify-between rounded-xl border border-border bg-[hsl(var(--surface-elevated))] px-3 text-left text-sm text-[hsl(var(--text-primary))] shadow-sm"
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
                  onClick={() =>
                    onChange(
                      checked
                        ? values.filter((value) => value !== option.value)
                        : [...values, option.value],
                    )
                  }
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm text-[hsl(var(--text-primary))]",
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
          </div>
        </div>
      ) : null}
    </div>
  );
}

const fieldClassName =
  "h-11 w-full rounded-xl border border-border bg-[hsl(var(--surface-elevated))] px-3 text-sm text-[hsl(var(--text-primary))] shadow-sm outline-none ring-offset-background transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1";

export type MasterReportFilterState = {
  warehouseIds: string[];
  brandValues: string[];
  categoryValues: string[];
  productIds: string[];
  partyTypes: string[];
  partyCategories: string[];
  states: string[];
  cities: string[];
  search: string;
  activeStatus: string;
  inactivityDays: string;
  dateFrom: string;
  dateTo: string;
};

export const defaultMasterReportFilters: MasterReportFilterState = {
  warehouseIds: [],
  brandValues: [],
  categoryValues: [],
  productIds: [],
  partyTypes: [],
  partyCategories: [],
  states: [],
  cities: [],
  search: "",
  activeStatus: "",
  inactivityDays: "30",
  dateFrom: "",
  dateTo: "",
};

// Which controls a given report wants to expose. Omit to show the full bar.
export type MasterReportFilterField =
  | "search"
  | "warehouseIds"
  | "brandValues"
  | "categoryValues"
  | "productIds"
  | "partyTypes"
  | "partyCategories"
  | "states"
  | "cities"
  | "dateFrom"
  | "dateTo"
  | "activeStatus"
  | "inactivityDays";

// Serialize the filter state into the query params the backend reports expect.
export function masterReportFilterQuery(
  state: MasterReportFilterState,
): Record<string, string | undefined> {
  return {
    warehouse_ids: state.warehouseIds.join(",") || undefined,
    brand_values: state.brandValues.join(",") || undefined,
    category_values: state.categoryValues.join(",") || undefined,
    product_ids: state.productIds.join(",") || undefined,
    party_types: state.partyTypes.join(",") || undefined,
    party_categories: state.partyCategories.join(",") || undefined,
    states: state.states.join(",") || undefined,
    cities: state.cities.join(",") || undefined,
    search: state.search.trim() || undefined,
    active_status: state.activeStatus || undefined,
    inactivity_days: state.inactivityDays || undefined,
    date_from: state.dateFrom || undefined,
    date_to: state.dateTo || undefined,
  };
}

type FilterActions = {
  onApply?: () => void;
  onClear: () => void;
  onExportCsv: () => void;
  onExportExcel: () => void;
  onPrint: () => void;
};

export function MasterReportFilterBar({
  options,
  value,
  onChange,
  actions,
  fields,
}: {
  options: MasterReportFilterOptions;
  value: MasterReportFilterState;
  onChange: (next: MasterReportFilterState) => void;
  actions: FilterActions;
  fields?: MasterReportFilterField[];
}) {
  const makeOptions = (values: string[]) => values.map((entry) => ({ label: entry, value: entry }));
  const show = (field: MasterReportFilterField) => !fields || fields.includes(field);

  return (
    <FilterCard
      title="Masters Filters"
      description="Business filters for warehouse, item, party, and geography based report cuts."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={actions.onExportCsv} className="gap-2">
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button type="button" variant="outline" onClick={actions.onExportExcel} className="gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Export Excel
          </Button>
          <Button type="button" variant="outline" onClick={actions.onPrint} className="gap-2">
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      }
    >
      {show("search") ? (
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value.search}
            onChange={(event) => onChange({ ...value, search: event.target.value })}
            placeholder="Search by name, GSTIN, PAN, drug licence, code, or city"
            className="h-11 rounded-xl pl-9"
          />
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {show("warehouseIds") ? (
          <MultiSelectFilter label="Warehouse" options={options.warehouses.map((entry) => ({ label: entry.label, value: String(entry.id) }))} values={value.warehouseIds} onChange={(warehouseIds) => onChange({ ...value, warehouseIds })} />
        ) : null}
        {show("brandValues") ? (
          <MultiSelectFilter label="Manufacturer" options={makeOptions(options.brands)} values={value.brandValues} onChange={(brandValues) => onChange({ ...value, brandValues })} />
        ) : null}
        {show("categoryValues") ? (
          <MultiSelectFilter label="Category" options={makeOptions(options.categories)} values={value.categoryValues} onChange={(categoryValues) => onChange({ ...value, categoryValues })} />
        ) : null}
        {show("productIds") ? (
          <MultiSelectFilter label="Product" options={options.products.map((entry) => ({ label: entry.label, value: String(entry.id) }))} values={value.productIds} onChange={(productIds) => onChange({ ...value, productIds })} />
        ) : null}
        {show("partyTypes") ? (
          <MultiSelectFilter label="Party Type" options={makeOptions(options.party_types)} values={value.partyTypes} onChange={(partyTypes) => onChange({ ...value, partyTypes })} />
        ) : null}
        {show("partyCategories") ? (
          <MultiSelectFilter label="Party Category" options={makeOptions(options.party_categories)} values={value.partyCategories} onChange={(partyCategories) => onChange({ ...value, partyCategories })} />
        ) : null}
        {show("states") ? (
          <MultiSelectFilter label="State" options={makeOptions(options.states)} values={value.states} onChange={(states) => onChange({ ...value, states })} />
        ) : null}
        {show("cities") ? (
          <MultiSelectFilter label="City" options={makeOptions(options.cities)} values={value.cities} onChange={(cities) => onChange({ ...value, cities })} />
        ) : null}
        {show("dateFrom") ? (
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-[hsl(var(--text-secondary))]">Date From</span>
            <Input type="date" value={value.dateFrom} onChange={(event) => onChange({ ...value, dateFrom: event.target.value })} className={fieldClassName} />
          </label>
        ) : null}
        {show("dateTo") ? (
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-[hsl(var(--text-secondary))]">Date To</span>
            <Input type="date" value={value.dateTo} onChange={(event) => onChange({ ...value, dateTo: event.target.value })} className={fieldClassName} />
          </label>
        ) : null}
        {show("activeStatus") ? (
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-[hsl(var(--text-secondary))]">Active / Inactive</span>
            <select value={value.activeStatus} onChange={(event) => onChange({ ...value, activeStatus: event.target.value })} className={fieldClassName}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        ) : null}
        {show("inactivityDays") ? (
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-[hsl(var(--text-secondary))]">Inactivity Days</span>
            <Input type="number" min="1" value={value.inactivityDays} onChange={(event) => onChange({ ...value, inactivityDays: event.target.value })} className={fieldClassName} />
          </label>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={actions.onClear} className="gap-2">
          <X className="h-4 w-4" />
          Clear Filters
        </Button>
      </div>
    </FilterCard>
  );
}

export type DataQualityFilterState = {
  entityTypes: string[];
  missingFieldType: string;
  duplicateType: string;
  complianceType: string;
};

export const defaultDataQualityFilters: DataQualityFilterState = {
  entityTypes: [],
  missingFieldType: "",
  duplicateType: "",
  complianceType: "",
};

export function DataQualityFilterBar({
  options,
  value,
  onChange,
  actions,
}: {
  options: DataQualityFilterOptions;
  value: DataQualityFilterState;
  onChange: (next: DataQualityFilterState) => void;
  actions: FilterActions;
}) {
  const makeOptions = (values: string[]) => values.map((entry) => ({ label: entry, value: entry }));

  return (
    <FilterCard
      title="Data Quality Filters"
      description="Investigate missing fields, duplicates, compliance gaps, and invalid references separately from business reports."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={actions.onExportCsv} className="gap-2">
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button type="button" variant="outline" onClick={actions.onExportExcel} className="gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Export Excel
          </Button>
          <Button type="button" variant="outline" onClick={actions.onPrint} className="gap-2">
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <MultiSelectFilter label="Entity Type" options={makeOptions(options.entity_types)} values={value.entityTypes} onChange={(entityTypes) => onChange({ ...value, entityTypes })} />
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-[hsl(var(--text-secondary))]">Missing Field Type</span>
          <select value={value.missingFieldType} onChange={(event) => onChange({ ...value, missingFieldType: event.target.value })} className={fieldClassName}>
            <option value="">All</option>
            {options.missing_field_types.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-[hsl(var(--text-secondary))]">Duplicate Type</span>
          <select value={value.duplicateType} onChange={(event) => onChange({ ...value, duplicateType: event.target.value })} className={fieldClassName}>
            <option value="">All</option>
            {options.duplicate_types.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-[hsl(var(--text-secondary))]">Compliance Type</span>
          <select value={value.complianceType} onChange={(event) => onChange({ ...value, complianceType: event.target.value })} className={fieldClassName}>
            <option value="">All</option>
            {options.compliance_types.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={actions.onClear} className="gap-2">
          <X className="h-4 w-4" />
          Clear Filters
        </Button>
        <Button type="button" onClick={actions.onApply}>
          Apply Filters
        </Button>
      </div>
    </FilterCard>
  );
}
