export type GenericReportColumn = {
  key: string;
  label: string;
};

export type GenericReportConfig = {
  slug: string;
  title: string;
  description: string;
  href: string;
  endpoint?: string;
  columns?: GenericReportColumn[];
  defaultFilters?: Record<string, string>;
  // When true, the master report viewer renders the shared filter/search bar.
  filterable?: boolean;
  // Which filter controls to expose (subset of MasterReportFilterField keys).
  filterFields?: string[];
  // When true, hide the summary metric tiles above the table.
  hideSummary?: boolean;
  testId: string;
  legacyKind?:
    | "current-stock"
    | "stock-movement"
    | "stock-ageing"
    | "expiry"
    | "dead-stock"
    | "opening-stock"
    | "purchase-register"
    | "stock-inward"
    | "purchase-credit-notes";
};

export const MASTERS_REPORTS: GenericReportConfig[] = [
  {
    slug: "current-stock",
    title: "Current Stock",
    description: "Real-time stock by SKU, warehouse, and batch.",
    href: "/reports/masters/current-stock",
    legacyKind: "current-stock",
    testId: "report-masters-current-stock",
  },
  {
    slug: "warehouse-item-summary",
    title: "Warehouse Item Summary",
    description: "SKU, batch, quantity, and value rollup by warehouse.",
    href: "/reports/masters/warehouse-item-summary",
    endpoint: "/api/reports/masters/warehouse-item-summary",
    testId: "report-masters-warehouse-item-summary",
    columns: [
      { key: "warehouse_name", label: "Warehouse Name" },
      { key: "total_skus", label: "Total SKUs" },
      { key: "total_batches", label: "Total Batches" },
      { key: "total_stock_qty", label: "Total Stock Qty" },
      { key: "total_stock_value", label: "Total Stock Value" },
      { key: "last_stock_movement_date", label: "Last Stock Movement Date" },
    ],
  },
  {
    slug: "warehouse-utilization",
    title: "Warehouse Utilization Report",
    description: "Identify active, low-usage, and unused warehouses.",
    href: "/reports/masters/warehouse-utilization",
    endpoint: "/api/reports/masters/warehouse-utilization",
    testId: "report-masters-warehouse-utilization",
    columns: [
      { key: "warehouse_name", label: "Warehouse Name" },
      { key: "total_transactions", label: "Total Transactions" },
      { key: "last_grn_date", label: "Last GRN Date" },
      { key: "last_stock_movement_date", label: "Last Stock Movement Date" },
      { key: "total_skus", label: "Total SKUs" },
      { key: "current_qty", label: "Current Qty" },
      { key: "utilization_status", label: "Utilization Status" },
    ],
  },
  {
    slug: "warehouse-coverage",
    title: "Warehouse Coverage Report",
    description: "Manufacturers, categories, products, and batches present in each warehouse.",
    href: "/reports/masters/warehouse-coverage",
    endpoint: "/api/reports/masters/warehouse-coverage",
    testId: "report-masters-warehouse-coverage",
    columns: [
      { key: "warehouse_name", label: "Warehouse Name" },
      { key: "brands_present", label: "Manufacturers Present" },
      { key: "categories_present", label: "Categories Present" },
      { key: "product_count", label: "Product Count" },
      { key: "batch_count", label: "Batch Count" },
    ],
  },
  {
    slug: "rack-report",
    title: "Rack Report",
    description: "Products assigned to each rack and their stock on hand, by warehouse.",
    href: "/reports/masters/rack-report",
    endpoint: "/api/reports/masters/rack-report",
    testId: "report-masters-rack-report",
    columns: [
      { key: "warehouse_name", label: "Warehouse" },
      { key: "rack_number", label: "Rack Number" },
      { key: "description", label: "Description" },
      { key: "products_assigned", label: "Products Assigned" },
      { key: "total_stock_qty", label: "Stock Qty" },
      { key: "total_stock_value", label: "Stock Value" },
      { key: "status", label: "Status" },
    ],
  },
  {
    slug: "item-directory",
    title: "Item Directory",
    description:
      "Searchable master list of every item — filter by manufacturer or status, search by SKU, name, or HSN.",
    href: "/reports/masters/item-directory",
    endpoint: "/api/reports/masters/item-directory",
    testId: "report-masters-item-directory",
    filterable: true,
    filterFields: ["search", "brandValues", "activeStatus"],
    hideSummary: true,
    columns: [
      { key: "sku", label: "SKU" },
      { key: "product_name", label: "Product Name" },
      { key: "brand", label: "Manufacturer" },
      { key: "category", label: "Category" },
      { key: "hsn", label: "HSN" },
      { key: "uom", label: "UOM" },
      { key: "gst_rate", label: "GST %" },
      { key: "default_warehouse", label: "Default Warehouse" },
      { key: "rack_number", label: "Rack" },
      { key: "mrp", label: "MRP" },
      { key: "status", label: "Status" },
    ],
  },
  {
    slug: "brand-item-report",
    title: "Manufacturer-wise Item Report",
    description: "Business item visibility and stock by manufacturer.",
    href: "/reports/masters/brand-item-report",
    endpoint: "/api/reports/masters/brand-item-report",
    testId: "report-masters-brand-item-report",
    columns: [
      { key: "brand", label: "Manufacturer" },
      { key: "item_count", label: "Item Count" },
      { key: "active_item_count", label: "Active Item Count" },
      { key: "warehouses_present_in", label: "Warehouses Present In" },
      { key: "total_stock_qty", label: "Total Stock Qty" },
      { key: "total_stock_value", label: "Total Stock Value" },
    ],
  },
  {
    slug: "category-item-report",
    title: "Category-wise Item Report",
    description: "Product visibility and stock by category.",
    href: "/reports/masters/category-item-report",
    endpoint: "/api/reports/masters/category-item-report",
    testId: "report-masters-category-item-report",
    columns: [
      { key: "category", label: "Category" },
      { key: "item_count", label: "Item Count" },
      { key: "active_item_count", label: "Active Item Count" },
      { key: "total_stock_qty", label: "Total Stock Qty" },
      { key: "total_stock_value", label: "Total Stock Value" },
    ],
  },
  {
    slug: "item-utilization",
    title: "Item Utilization Report",
    description: "See which items are active in business operations.",
    href: "/reports/masters/item-utilization",
    endpoint: "/api/reports/masters/item-utilization",
    testId: "report-masters-item-utilization",
    columns: [
      { key: "sku", label: "SKU" },
      { key: "product_name", label: "Product Name" },
      { key: "brand", label: "Manufacturer" },
      { key: "category", label: "Category" },
      { key: "warehouses_present_in", label: "Warehouses Present In" },
      { key: "last_movement_date", label: "Last Movement Date" },
      { key: "total_current_qty", label: "Total Current Qty" },
    ],
  },
  {
    slug: "item-distribution",
    title: "Item Stock Distribution Report",
    description: "See where each product is stocked.",
    href: "/reports/masters/item-distribution",
    endpoint: "/api/reports/masters/item-distribution",
    testId: "report-masters-item-distribution",
    columns: [
      { key: "sku", label: "SKU" },
      { key: "product_name", label: "Product Name" },
      { key: "brand", label: "Manufacturer" },
      { key: "warehouse", label: "Warehouse" },
      { key: "batch_count", label: "Batch Count" },
      { key: "qty", label: "Qty" },
      { key: "stock_value", label: "Stock Value" },
    ],
  },
  {
    slug: "party-directory",
    title: "Party Directory",
    description: "Searchable master list of every party — filter by location, type, status, or search by GSTIN.",
    href: "/reports/masters/party-directory",
    endpoint: "/api/reports/masters/party-directory",
    testId: "report-masters-party-directory",
    filterable: true,
    filterFields: ["search", "partyTypes", "partyCategories", "states", "cities", "activeStatus"],
    hideSummary: true,
    columns: [
      { key: "party_code", label: "Code" },
      { key: "party_name", label: "Party Name" },
      { key: "party_type", label: "Type" },
      { key: "party_category", label: "Category" },
      { key: "state", label: "State" },
      { key: "city", label: "City" },
      { key: "gstin", label: "GSTIN" },
      { key: "pan_number", label: "PAN" },
      { key: "drug_license_number", label: "Drug Licence" },
      { key: "mobile", label: "Mobile" },
      { key: "email", label: "Email" },
      { key: "credit_limit", label: "Credit Limit" },
      { key: "status", label: "Status" },
    ],
  },
  {
    slug: "party-type-report",
    title: "Party Type Report",
    description: "Analyze customers, suppliers, and dual-role parties.",
    href: "/reports/masters/party-type-report",
    endpoint: "/api/reports/masters/party-type-report",
    testId: "report-masters-party-type-report",
    columns: [
      { key: "party_type", label: "Party Type" },
      { key: "party_category", label: "Party Category" },
      { key: "total_parties", label: "Total Parties" },
      { key: "active_parties", label: "Active Parties" },
      { key: "states_covered", label: "States Covered" },
      { key: "last_activity_date", label: "Last Activity Date" },
    ],
  },
  {
    slug: "party-geography-report",
    title: "Party Geography Report",
    description: "State and city distribution of business parties.",
    href: "/reports/masters/party-geography-report",
    endpoint: "/api/reports/masters/party-geography-report",
    testId: "report-masters-party-geography-report",
    columns: [
      { key: "state", label: "State" },
      { key: "city", label: "City" },
      { key: "party_count", label: "Party Count" },
      { key: "supplier_count", label: "Supplier Count" },
      { key: "customer_count", label: "Customer Count" },
      { key: "both_count", label: "Both Count" },
    ],
  },
  {
    slug: "party-commercial-report",
    title: "Party Commercial Report",
    description: "Commercial terms, credit limits, and tracking modes across parties.",
    href: "/reports/masters/party-commercial-report",
    endpoint: "/api/reports/masters/party-commercial-report",
    testId: "report-masters-party-commercial-report",
    columns: [
      { key: "party_name", label: "Party Name" },
      { key: "party_type", label: "Party Type" },
      { key: "category", label: "Category" },
      { key: "credit_limit", label: "Credit Limit" },
      { key: "payment_terms", label: "Payment Terms" },
      { key: "opening_balance", label: "Opening Balance" },
      { key: "outstanding_tracking_mode", label: "Outstanding Tracking Mode" },
    ],
  },
  {
    slug: "party-activity-report",
    title: "Party Activity Report",
    description: "Last purchase, GRN, and sales activity by party.",
    href: "/reports/masters/party-activity-report",
    endpoint: "/api/reports/masters/party-activity-report",
    testId: "report-masters-party-activity-report",
    columns: [
      { key: "party_name", label: "Party Name" },
      { key: "party_type", label: "Party Type" },
      { key: "category", label: "Category" },
      { key: "state", label: "State" },
      { key: "last_purchase_date", label: "Last Purchase Date" },
      { key: "last_grn_date", label: "Last GRN Date" },
      { key: "last_sales_date", label: "Last Sales Date" },
      { key: "active_flag", label: "Active Flag" },
    ],
  },
  {
    slug: "brand-summary-report",
    title: "Manufacturer Performance Support Report",
    description: "Master-level visibility by manufacturer across stock and warehouses.",
    href: "/reports/masters/brand-summary-report",
    endpoint: "/api/reports/masters/brand-summary-report",
    testId: "report-masters-brand-summary-report",
    columns: [
      { key: "brand", label: "Manufacturer" },
      { key: "item_count", label: "Item Count" },
      { key: "warehouse_count", label: "Warehouse Count" },
      { key: "total_qty", label: "Total Qty" },
      { key: "total_stock_value", label: "Total Stock Value" },
      { key: "last_movement_date", label: "Last Movement Date" },
    ],
  },
  {
    slug: "category-summary-report",
    title: "Category Summary Report",
    description: "Business visibility by item category.",
    href: "/reports/masters/category-summary-report",
    endpoint: "/api/reports/masters/category-summary-report",
    testId: "report-masters-category-summary-report",
    columns: [
      { key: "category", label: "Category" },
      { key: "item_count", label: "Item Count" },
      { key: "warehouse_count", label: "Warehouse Count" },
      { key: "total_qty", label: "Total Qty" },
      { key: "total_stock_value", label: "Total Stock Value" },
      { key: "last_movement_date", label: "Last Movement Date" },
    ],
  },
  {
    slug: "low-usage-unused-warehouses",
    title: "Low Usage / Unused Warehouses",
    description: "Explicit view of warehouses with weak operational usage.",
    href: "/reports/masters/low-usage-unused-warehouses",
    endpoint: "/api/reports/masters/low-usage-unused-warehouses",
    testId: "report-masters-low-usage-unused-warehouses",
    columns: [
      { key: "warehouse_name", label: "Warehouse Name" },
      { key: "total_transactions", label: "Total Transactions" },
      { key: "current_qty", label: "Current Qty" },
      { key: "last_stock_movement_date", label: "Last Stock Movement Date" },
      { key: "utilization_status", label: "Utilization Status" },
    ],
  },
];

export type MastersReportCategoryId = "parties" | "items" | "warehouse";

// Single source of truth for how masters reports group into Party / Item /
// Warehouse — drives both the reports hub tabs and the sidebar grouping so the
// two never drift. Order here is the display order: Party, Item, Warehouse.
export const MASTERS_REPORT_CATEGORIES: ReadonlyArray<{
  id: MastersReportCategoryId;
  label: string;
  slugs: readonly string[];
}> = [
  {
    id: "parties",
    label: "Party",
    slugs: [
      "party-directory",
      "party-type-report",
      "party-geography-report",
      "party-commercial-report",
      "party-activity-report",
    ],
  },
  {
    id: "items",
    label: "Item",
    slugs: [
      "item-directory",
      "brand-item-report",
      "category-item-report",
      "item-utilization",
      "item-distribution",
      "brand-summary-report",
      "category-summary-report",
    ],
  },
  {
    id: "warehouse",
    label: "Warehouse",
    slugs: [
      "current-stock",
      "warehouse-item-summary",
      "warehouse-utilization",
      "warehouse-coverage",
      "rack-report",
      "low-usage-unused-warehouses",
    ],
  },
];

// Masters reports for one category, in the order declared above.
export function mastersReportsByCategory(
  id: MastersReportCategoryId,
): GenericReportConfig[] {
  const category = MASTERS_REPORT_CATEGORIES.find((entry) => entry.id === id);
  if (!category) {
    return [];
  }
  const order = new Map(category.slugs.map((slug, index) => [slug, index] as const));
  return MASTERS_REPORTS.filter((report) => order.has(report.slug)).sort(
    (left, right) => (order.get(left.slug) ?? 0) - (order.get(right.slug) ?? 0),
  );
}

export const DATA_QUALITY_REPORTS: GenericReportConfig[] = [
  {
    slug: "missing-fields",
    title: "Missing Fields",
    description: "Missing mandatory or business-critical master attributes.",
    href: "/reports/data-quality/missing-fields",
    endpoint: "/api/reports/data-quality/missing-fields",
    testId: "report-dq-missing-fields",
    columns: [
      { key: "entity_type", label: "Entity Type" },
      { key: "entity_name", label: "Entity Name" },
      { key: "entity_id", label: "Entity ID" },
      { key: "missing_fields", label: "Missing Fields" },
    ],
  },
  {
    slug: "duplicate-masters",
    title: "Duplicate Masters",
    description: "Duplicate master records by identifier or business key.",
    href: "/reports/data-quality/duplicate-masters",
    endpoint: "/api/reports/data-quality/duplicate-masters",
    testId: "report-dq-duplicate-masters",
    columns: [
      { key: "entity_type", label: "Entity Type" },
      { key: "duplicate_type", label: "Duplicate Type" },
      { key: "duplicate_value", label: "Duplicate Value" },
      { key: "record_count", label: "Record Count" },
    ],
  },
  {
    slug: "compliance-gaps",
    title: "Compliance Gaps",
    description: "Missing GST, PAN, license, and compliance identifiers.",
    href: "/reports/data-quality/compliance-gaps",
    endpoint: "/api/reports/data-quality/compliance-gaps",
    testId: "report-dq-compliance-gaps",
    columns: [
      { key: "entity_type", label: "Entity Type" },
      { key: "entity_name", label: "Entity Name" },
      { key: "entity_id", label: "Entity ID" },
      { key: "compliance_gaps", label: "Compliance Gaps" },
    ],
  },
  {
    slug: "invalid-references",
    title: "Invalid Master References",
    description: "Business records pointing to inactive or invalid masters.",
    href: "/reports/data-quality/invalid-references",
    endpoint: "/api/reports/data-quality/invalid-references",
    testId: "report-dq-invalid-references",
    columns: [
      { key: "entity_type", label: "Entity Type" },
      { key: "entity_id", label: "Entity ID" },
      { key: "reference_issue", label: "Reference Issue" },
      { key: "details", label: "Details" },
    ],
  },
];

export const PURCHASE_ANALYTICS_REPORTS: GenericReportConfig[] = [
  {
    slug: "purchase-cost-trend",
    title: "Purchase Cost Trend",
    description: "Track purchase rate movement over time by product and supplier.",
    href: "/reports/purchase-analytics/purchase-cost-trend",
    endpoint: "/api/reports/purchase-analytics/purchase-cost-trend",
    testId: "report-pa-purchase-cost-trend",
    columns: [
      { key: "product", label: "Product" },
      { key: "supplier", label: "Supplier" },
      { key: "month", label: "Month" },
      { key: "avg_purchase_rate", label: "Avg Purchase Rate" },
      { key: "last_purchase_rate", label: "Last Purchase Rate" },
      { key: "purchase_qty", label: "Purchase Qty" },
      { key: "purchase_value", label: "Purchase Value" },
    ],
  },
  {
    slug: "seasonal-purchase-pattern",
    title: "Seasonal Purchase Pattern",
    description: "Identify peak buying months and seasonality by product.",
    href: "/reports/purchase-analytics/seasonal-purchase-pattern",
    endpoint: "/api/reports/purchase-analytics/seasonal-purchase-pattern",
    testId: "report-pa-seasonal-purchase-pattern",
    columns: [
      { key: "product", label: "Product" },
      { key: "brand", label: "Brand" },
      { key: "month", label: "Month" },
      { key: "purchase_qty", label: "Purchase Qty" },
      { key: "purchase_value", label: "Purchase Value" },
      { key: "peak_month_flag", label: "Peak Month" },
    ],
  },
  {
    slug: "supplier-lead-time",
    title: "Supplier Lead Time",
    description: "Measure PO-to-GRN responsiveness and receipt fragmentation.",
    href: "/reports/purchase-analytics/supplier-lead-time",
    endpoint: "/api/reports/purchase-analytics/supplier-lead-time",
    testId: "report-pa-supplier-lead-time",
    columns: [
      { key: "supplier", label: "Supplier" },
      { key: "avg_days_to_first_grn", label: "Avg Days to First GRN" },
      { key: "avg_days_to_full_receipt", label: "Avg Days to Full Receipt" },
      { key: "total_pos", label: "Total POs" },
      { key: "partial_receipt_count", label: "Partial Receipt Count" },
      { key: "total_received_qty", label: "Total Received Qty" },
    ],
  },
  {
    slug: "supplier-price-comparison",
    title: "Supplier Price Comparison",
    description: "Compare supplier pricing for the same product and surface rank gaps.",
    href: "/reports/purchase-analytics/supplier-price-comparison",
    endpoint: "/api/reports/purchase-analytics/supplier-price-comparison",
    testId: "report-pa-supplier-price-comparison",
    columns: [
      { key: "product", label: "Product" },
      { key: "supplier", label: "Supplier" },
      { key: "last_purchase_rate", label: "Last Purchase Rate" },
      { key: "avg_purchase_rate", label: "Avg Purchase Rate" },
      { key: "lowest_rate", label: "Lowest Rate" },
      { key: "highest_rate", label: "Highest Rate" },
      { key: "variance_pct", label: "Variance %" },
      { key: "rank", label: "Rank" },
    ],
  },
  {
    slug: "po-fulfillment-quality",
    title: "PO Fulfillment Quality",
    description: "Measure fill rate, splits, closure quality, and receipt cleanliness.",
    href: "/reports/purchase-analytics/po-fulfillment-quality",
    endpoint: "/api/reports/purchase-analytics/po-fulfillment-quality",
    testId: "report-pa-po-fulfillment-quality",
    columns: [
      { key: "supplier", label: "Supplier" },
      { key: "total_ordered_qty", label: "Total Ordered Qty" },
      { key: "total_received_qty", label: "Total Received Qty" },
      { key: "fill_rate_pct", label: "Fill Rate %" },
      { key: "avg_grn_count_per_po", label: "Avg GRN Count per PO" },
      { key: "partial_receipt_frequency", label: "Partial Receipt Frequency" },
      { key: "closed_po_count", label: "Closed PO Count" },
    ],
  },
];

export function findMastersReport(slug: string) {
  return MASTERS_REPORTS.find((report) => report.slug === slug) ?? null;
}

export function findDataQualityReport(slug: string) {
  return DATA_QUALITY_REPORTS.find((report) => report.slug === slug) ?? null;
}

export function findPurchaseAnalyticsReport(slug: string) {
  return PURCHASE_ANALYTICS_REPORTS.find((report) => report.slug === slug) ?? null;
}
