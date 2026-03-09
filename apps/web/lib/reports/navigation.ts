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
    description: "Brands, categories, products, and batches present in each warehouse.",
    href: "/reports/masters/warehouse-coverage",
    endpoint: "/api/reports/masters/warehouse-coverage",
    testId: "report-masters-warehouse-coverage",
    columns: [
      { key: "warehouse_name", label: "Warehouse Name" },
      { key: "brands_present", label: "Brands Present" },
      { key: "categories_present", label: "Categories Present" },
      { key: "product_count", label: "Product Count" },
      { key: "batch_count", label: "Batch Count" },
    ],
  },
  {
    slug: "brand-item-report",
    title: "Brand-wise Item Report",
    description: "Business item visibility and stock by brand.",
    href: "/reports/masters/brand-item-report",
    endpoint: "/api/reports/masters/brand-item-report",
    testId: "report-masters-brand-item-report",
    columns: [
      { key: "brand", label: "Brand" },
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
      { key: "brand", label: "Brand" },
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
      { key: "brand", label: "Brand" },
      { key: "warehouse", label: "Warehouse" },
      { key: "batch_count", label: "Batch Count" },
      { key: "qty", label: "Qty" },
      { key: "stock_value", label: "Stock Value" },
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
    title: "Brand Performance Support Report",
    description: "Master-level visibility by brand across stock and warehouses.",
    href: "/reports/masters/brand-summary-report",
    endpoint: "/api/reports/masters/brand-summary-report",
    testId: "report-masters-brand-summary-report",
    columns: [
      { key: "brand", label: "Brand" },
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
    slug: "inactive-parties",
    title: "Inactive Parties",
    description: "Explicit business view of inactive party masters.",
    href: "/reports/masters/inactive-parties",
    endpoint: "/api/reports/masters/inactive-parties",
    testId: "report-masters-inactive-parties",
    columns: [
      { key: "party_name", label: "Party Name" },
      { key: "party_type", label: "Party Type" },
      { key: "party_category", label: "Party Category" },
      { key: "state", label: "State" },
      { key: "city", label: "City" },
      { key: "gstin", label: "GSTIN" },
      { key: "updated_at", label: "Updated At" },
    ],
  },
  {
    slug: "inactive-items",
    title: "Inactive Items",
    description: "Explicit view of inactive item masters.",
    href: "/reports/masters/inactive-items",
    endpoint: "/api/reports/masters/inactive-items",
    testId: "report-masters-inactive-items",
    columns: [
      { key: "sku", label: "SKU" },
      { key: "product_name", label: "Product Name" },
      { key: "brand", label: "Brand" },
      { key: "category", label: "Category" },
      { key: "gst_rate", label: "GST %" },
      { key: "updated_at", label: "Updated At" },
    ],
  },
  {
    slug: "inactive-warehouses",
    title: "Deleted / Inactive Warehouses",
    description: "Warehouse masters that are no longer active.",
    href: "/reports/masters/inactive-warehouses",
    endpoint: "/api/reports/masters/inactive-warehouses",
    testId: "report-masters-inactive-warehouses",
    columns: [
      { key: "warehouse_name", label: "Warehouse Name" },
      { key: "warehouse_code", label: "Warehouse Code" },
      { key: "address", label: "Address" },
      { key: "updated_at", label: "Updated At" },
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

export function findMastersReport(slug: string) {
  return MASTERS_REPORTS.find((report) => report.slug === slug) ?? null;
}

export function findDataQualityReport(slug: string) {
  return DATA_QUALITY_REPORTS.find((report) => report.slug === slug) ?? null;
}
