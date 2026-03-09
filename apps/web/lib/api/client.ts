export type ApiError = {
  error_code?: string;
  detail?:
    | string
    | {
        error_code?: string;
        message?: string;
        details?: unknown;
      }
    | { msg?: string }[];
  message?: string;
  details?: unknown;
};

export type LoginPayload = {
  email: string;
  password: string;
  organization_slug?: string;
};

export type Role = {
  id: number;
  name: string;
  description?: string | null;
  is_system?: boolean;
};

export type ThemePreference = "light" | "dark" | "system";

export type AuthUser = {
  id: number;
  email: string;
  full_name: string;
  organization_slug?: string | null;
  theme_preference: ThemePreference;
  is_active: boolean;
  is_superuser: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  role: Role | null;
  roles: Role[];
  permissions: string[];
};

export type ManagedRole = {
  id: number;
  name: string;
  description?: string | null;
  is_system?: boolean;
};

export type ManagedUser = {
  id: number;
  email: string;
  full_name: string;
  organization_slug?: string | null;
  theme_preference: ThemePreference;
  is_active: boolean;
  is_superuser: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  role: ManagedRole | null;
  roles: ManagedRole[];
  permissions: string[];
};

export type ManagedUserCreatePayload = {
  email: string;
  password: string;
  full_name: string;
  is_active: boolean;
  is_superuser?: boolean;
  role_ids: number[];
};

export type PartyType =
  | "CUSTOMER"
  | "SUPPLIER"
  | "BOTH"
  | "MANUFACTURER"
  | "SUPER_STOCKIST"
  | "DISTRIBUTOR"
  | "HOSPITAL"
  | "PHARMACY"
  | "RETAILER"
  | "CONSUMER";

export type PartyCategory = string;

export type RegistrationType =
  | "REGISTERED"
  | "UNREGISTERED"
  | "COMPOSITION"
  | "SEZ"
  | "OTHER";

export type OutstandingTrackingMode = "BILL_WISE" | "FIFO" | "ON_ACCOUNT";

export type Party = {
  id: number;
  party_name: string;
  name: string;
  display_name: string | null;
  party_code: string | null;
  party_type: PartyType;
  party_category: string | null;
  contact_person: string | null;
  designation: string | null;
  mobile: string | null;
  phone: string | null;
  whatsapp_no: string | null;
  office_phone: string | null;
  email: string | null;
  website: string | null;
  address_line_1: string | null;
  address: string | null;
  address_line_2: string | null;
  state: string | null;
  city: string | null;
  pincode: string | null;
  country: string | null;
  gstin: string | null;
  pan_number: string | null;
  registration_type: RegistrationType | null;
  drug_license_number: string | null;
  fssai_number: string | null;
  udyam_number: string | null;
  credit_limit: string | null;
  payment_terms: string | null;
  opening_balance: string | null;
  outstanding_tracking_mode: OutstandingTrackingMode | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Warehouse = {
  id: number;
  name: string;
  code: string;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type WarehouseDeleteResult = {
  id: number;
  action: "deleted" | "deactivated";
  message: string;
  warehouse: Warehouse;
};

export type WarehouseBulkDeleteResult = {
  deleted_count: number;
  deactivated_count: number;
  failed_count: number;
  errors: Array<{ id: number | null; message: string }>;
};

export type Product = {
  id: number;
  sku: string;
  name: string;
  brand: string | null;
  uom: string;
  quantity_precision: number;
  barcode: string | null;
  hsn: string | null;
  gst_rate: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TaxRate = {
  id: number;
  code: string;
  label: string;
  rate_percent: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Category = {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Brand = {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type DashboardMetrics = {
  total_products: number;
  total_parties: number;
  total_warehouses: number;
  stock_items_count: number;
};

export type UserPreferences = {
  theme_preference: ThemePreference;
};

export type CompanySettings = {
  organization_name: string | null;
  company_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gst_number: string | null;
  pan_number: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type CompanySettingsPayload = {
  company_name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  gst_number?: string | null;
  pan_number?: string | null;
  phone?: string | null;
  email?: string | null;
  logo_url?: string | null;
};

export type TaxRatePayload = {
  code: string;
  label: string;
  rate_percent: number;
  is_active?: boolean;
};

export type CategoryPayload = {
  name: string;
  is_active?: boolean;
};

export type BrandPayload = {
  name: string;
  is_active?: boolean;
};

export type PartyPayload = {
  party_name: string;
  name?: string;
  display_name?: string;
  party_code?: string;
  party_type: PartyType;
  party_category?: string;
  contact_person?: string;
  designation?: string;
  mobile?: string;
  phone?: string;
  whatsapp_no?: string;
  office_phone?: string;
  email?: string;
  website?: string;
  address_line_1?: string;
  address?: string;
  address_line_2?: string;
  state?: string;
  city?: string;
  pincode?: string;
  country?: string;
  gstin?: string;
  pan_number?: string;
  registration_type?: RegistrationType;
  drug_license_number?: string;
  fssai_number?: string;
  udyam_number?: string;
  credit_limit?: string;
  payment_terms?: string;
  opening_balance?: string;
  outstanding_tracking_mode?: OutstandingTrackingMode;
  is_active: boolean;
};

export type BulkImportError = {
  row: number;
  field: string | null;
  message: string;
};

export type BulkImportResult = {
  created_count: number;
  failed_count: number;
  errors: BulkImportError[];
};

export type InventoryStockItem = {
  warehouse_id: number;
  warehouse_name: string;
  product_id: number;
  sku: string;
  product_name: string;
  quantity_precision: number;
  batch_id: number;
  batch_no: string;
  expiry_date: string;
  mfg_date: string | null;
  mrp: string | null;
  reference_id: string | null;
  qty_on_hand: string;
};

export type InventoryStockItemListResponse = {
  total: number;
  page: number;
  page_size: number;
  data: InventoryStockItem[];
};

export type StockCorrectionPayload = {
  warehouse_id: number;
  product_id: number;
  source_batch_id: number;
  qty_to_reclassify: string;
  corrected_batch_no: string;
  corrected_expiry_date: string;
  corrected_mfg_date?: string;
  corrected_mrp?: string;
  reference_id?: string;
  corrected_reference_id?: string;
  reason: string;
  remarks?: string;
};

export type StockCorrectionResponse = {
  id: number;
  reference_id: string;
  source_batch_id: number;
  corrected_batch_id: number;
  qty_to_reclassify: string;
  source_qty_on_hand: string;
  corrected_qty_on_hand: string;
  created_at: string;
};

export type StockCorrectionRecord = {
  id: number;
  reference_id: string;
  product_name: string;
  sku: string;
  warehouse_name: string;
  source_batch_no: string;
  source_expiry_date: string;
  corrected_batch_no: string;
  corrected_expiry_date: string;
  qty_to_reclassify: string;
  reason: string;
  remarks: string | null;
  created_by_name: string | null;
  created_at: string;
};

export type StockCorrectionListResponse = {
  total: number;
  page: number;
  page_size: number;
  data: StockCorrectionRecord[];
};

export type StockAdjustmentType = "POSITIVE" | "NEGATIVE";

export type StockAdjustmentReason =
  | "STOCK_COUNT_CORRECTION"
  | "DAMAGED"
  | "EXPIRED"
  | "FOUND_STOCK"
  | "OPENING_BALANCE_FIX"
  | "THEFT"
  | "BREAKAGE"
  | "OTHER";

export type StockAdjustmentPayload = {
  warehouse_id: number;
  product_id: number;
  batch_id: number;
  adjustment_type: StockAdjustmentType;
  qty: string;
  reason: StockAdjustmentReason;
  remarks?: string;
};

export type StockAdjustmentResponse = {
  id: number;
  reference_id: string;
  ledger_id: number;
  txn_type: "ADJUST";
  qty: string;
  before_qty: string;
  after_qty: string;
  created_at: string;
};

export type StockAdjustmentRecord = {
  id: number;
  reference_id: string;
  product_name: string;
  sku: string;
  warehouse_name: string;
  batch_no: string;
  expiry_date: string;
  adjustment_type: StockAdjustmentType;
  qty: string;
  reason: StockAdjustmentReason;
  remarks: string | null;
  before_qty: string;
  after_qty: string;
  created_by_name: string | null;
  created_at: string;
};

export type StockAdjustmentListResponse = {
  total: number;
  page: number;
  page_size: number;
  data: StockAdjustmentRecord[];
};

export type AuditLogRecord = {
  id: string;
  timestamp: string;
  user_id: string | null;
  user_name: string | null;
  module: string;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string | null;
  reason: string | null;
  remarks: string | null;
  source_screen: string | null;
  source_reference: string | null;
  changed_fields: string[];
};

export type AuditLogDetail = AuditLogRecord & {
  before_snapshot: Record<string, unknown> | null;
  after_snapshot: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

export type AuditLogListResponse = {
  total: number;
  page: number;
  page_size: number;
  data: AuditLogRecord[];
};

export type RecordHistoryResponse = {
  entity_type: string;
  entity_id: number;
  entries: AuditLogDetail[];
};

export type WarehousePayload = {
  name: string;
  code: string;
  address?: string;
  is_active: boolean;
};

export type ProductPayload = {
  sku: string;
  name: string;
  brand?: string;
  uom: string;
  quantity_precision?: number;
  barcode?: string;
  hsn?: string;
  gst_rate?: string;
  is_active: boolean;
};

export type PurchaseOrderStatus =
  | "DRAFT"
  | "APPROVED"
  | "PARTIALLY_RECEIVED"
  | "CLOSED"
  | "CANCELLED";

export type GrnStatus = "DRAFT" | "POSTED" | "CANCELLED";

export type PurchaseOrderLine = {
  id: number;
  purchase_order_id: number;
  product_id: number;
  product_name?: string | null;
  product_sku?: string | null;
  hsn_code?: string | null;
  ordered_qty: string;
  received_qty: string;
  unit_cost: string | null;
  free_qty: string;
  discount_amount: string;
  taxable_value: string;
  gst_percent: string;
  cgst_percent: string;
  sgst_percent: string;
  igst_percent: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  tax_amount: string;
  line_total: string;
  line_notes: string | null;
};

export type PurchaseOrder = {
  id: number;
  po_number: string;
  supplier_id: number;
  supplier_name?: string | null;
  warehouse_id: number;
  warehouse_name?: string | null;
  status: PurchaseOrderStatus;
  order_date: string;
  expected_date: string | null;
  notes: string | null;
  tax_type: string | null;
  subtotal: string;
  discount_percent: string;
  discount_amount: string;
  taxable_value: string;
  gst_percent: string;
  cgst_percent: string;
  sgst_percent: string;
  igst_percent: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  total_tax: string;
  adjustment: string;
  final_total: string;
  created_by: number;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
  lines: PurchaseOrderLine[];
};

export type PurchaseOrderListQuery = {
  search?: string;
  status?: PurchaseOrderStatus | "ALL";
  supplier_id?: number;
  warehouse_id?: number;
  date_from?: string;
  date_to?: string;
};

export type PurchaseOrderLinePayload = {
  product_id: number;
  ordered_qty: string;
  unit_cost?: string;
  free_qty?: string;
  line_notes?: string;
};

export type PurchaseOrderPayload = {
  supplier_id: number;
  warehouse_id: number;
  order_date: string;
  expected_date?: string;
  notes?: string;
  discount_percent: number;
  gst_percent: number;
  adjustment: number;
  lines: PurchaseOrderLinePayload[];
};

export type PurchaseBillStatus = "DRAFT" | "VERIFIED" | "POSTED" | "CANCELLED";

export type PurchaseBillExtractionStatus =
  | "NOT_STARTED"
  | "EXTRACTED"
  | "REVIEWED"
  | "FAILED";

export type DocumentAttachment = {
  id: number;
  entity_type: string;
  entity_id: number;
  file_name: string;
  file_type: string;
  storage_path: string;
  uploaded_by: number;
  uploaded_at: string;
};

export type PurchaseBillLine = {
  id: number;
  purchase_bill_id: number;
  product_id: number | null;
  description_raw: string;
  hsn_code: string | null;
  qty: string;
  unit: string | null;
  unit_price: string;
  discount_amount: string;
  gst_percent: string;
  line_total: string;
  batch_no: string | null;
  expiry_date: string | null;
  confidence_score: string | null;
};

export type PurchaseBill = {
  id: number;
  bill_number: string;
  supplier_id: number | null;
  supplier_name_raw: string | null;
  supplier_gstin: string | null;
  bill_date: string | null;
  due_date: string | null;
  warehouse_id: number | null;
  status: PurchaseBillStatus;
  subtotal: string;
  discount_amount: string;
  taxable_value: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  adjustment: string;
  total: string;
  extraction_status: PurchaseBillExtractionStatus;
  extraction_confidence: string | null;
  attachment_id: number | null;
  purchase_order_id: number | null;
  grn_id: number | null;
  extracted_json: Record<string, unknown> | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  remarks: string | null;
  attachment: DocumentAttachment | null;
  lines: PurchaseBillLine[];
};

export type PurchaseBillLinePayload = {
  product_id?: number | null;
  description_raw: string;
  hsn_code?: string | null;
  qty: string;
  unit?: string | null;
  unit_price: string;
  discount_amount: string;
  gst_percent: string;
  line_total: string;
  batch_no?: string | null;
  expiry_date?: string | null;
  confidence_score?: string | null;
};

export type PurchaseBillUpdatePayload = {
  bill_number?: string | null;
  supplier_id?: number | null;
  supplier_name_raw?: string | null;
  supplier_gstin?: string | null;
  bill_date?: string | null;
  due_date?: string | null;
  warehouse_id?: number | null;
  subtotal?: string;
  discount_amount?: string;
  taxable_value?: string;
  cgst_amount?: string;
  sgst_amount?: string;
  igst_amount?: string;
  adjustment?: string;
  total?: string;
  purchase_order_id?: number | null;
  grn_id?: number | null;
  remarks?: string | null;
  lines?: PurchaseBillLinePayload[];
};

export type GrnBatchLine = {
  id: number;
  grn_line_id: number;
  batch_no: string;
  expiry_date: string;
  mfg_date: string | null;
  mrp: string | null;
  received_qty: string;
  free_qty: string;
  unit_cost: string | null;
  batch_id: number | null;
  remarks: string | null;
};

export type GrnLine = {
  id: number;
  grn_id: number;
  po_line_id: number | null;
  purchase_order_line_id: number | null;
  purchase_bill_line_id: number | null;
  product_id: number;
  product_name: string | null;
  product_sku: string | null;
  hsn_code: string | null;
  product_name_snapshot: string | null;
  ordered_qty_snapshot: string | null;
  billed_qty_snapshot: string | null;
  received_qty_total: string;
  free_qty_total: string;
  batch_id: number | null;
  received_qty: string;
  free_qty: string;
  unit_cost: string | null;
  expiry_date: string | null;
  remarks: string | null;
  batch_lines: GrnBatchLine[];
};

export type Grn = {
  id: number;
  grn_number: string;
  purchase_order_id: number;
  po_number: string | null;
  purchase_bill_id: number | null;
  purchase_bill_number: string | null;
  supplier_id: number;
  supplier_name: string | null;
  warehouse_id: number;
  warehouse_name: string | null;
  status: GrnStatus;
  received_date: string;
  remarks: string | null;
  posted_at: string | null;
  posted_by: number | null;
  posted_by_name: string | null;
  created_by: number;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  total_products: number;
  total_received_qty: string;
  lines: GrnLine[];
};

export type PurchaseCreditNoteStatus = "GENERATED" | "ADJUSTED";

export type PurchaseCreditNote = {
  id: number;
  credit_note_number: string;
  supplier_id: number;
  warehouse_id: number;
  purchase_return_id: number;
  total_amount: string;
  status: PurchaseCreditNoteStatus;
  created_at: string;
  created_by: number;
};

export type SalesOrderStatus =
  | "DRAFT"
  | "CONFIRMED"
  | "PARTIALLY_DISPATCHED"
  | "DISPATCHED"
  | "CANCELLED";

export type StockReservationStatus =
  | "ACTIVE"
  | "PARTIALLY_CONSUMED"
  | "CONSUMED"
  | "RELEASED";

export type DispatchNoteStatus = "DRAFT" | "POSTED" | "CANCELLED";

export type SalesOrderLine = {
  id: number;
  sales_order_id: number;
  product_id: number;
  ordered_qty: string;
  reserved_qty: string;
  dispatched_qty: string;
  unit_price: string;
  discount_percent: string;
  line_total: string;
  gst_rate: string;
  hsn_code: string | null;
  remarks: string | null;
};

export type SalesOrder = {
  id: number;
  so_number: string;
  customer_id: number;
  warehouse_id: number;
  status: SalesOrderStatus;
  order_date: string;
  expected_dispatch_date: string | null;
  remarks: string | null;
  subtotal: string;
  discount_percent: string;
  discount_amount: string;
  tax_type: string | null;
  tax_percent: string;
  tax_amount: string;
  adjustment: string;
  total: string;
  created_by: number;
  created_at: string;
  updated_at: string;
  lines: SalesOrderLine[];
};

export type SalesOrderLinePayload = {
  product_id: number;
  ordered_qty: string;
  unit_price?: string;
  discount_percent?: string;
  gst_rate?: string;
  hsn_code?: string;
  remarks?: string;
};

export type SalesOrderPayload = {
  customer_id: number;
  warehouse_id: number;
  order_date: string;
  expected_dispatch_date?: string;
  remarks?: string;
  subtotal?: string;
  discount_percent?: string;
  discount_amount?: string;
  tax_type?: string;
  tax_percent?: string;
  tax_amount?: string;
  adjustment?: string;
  total?: string;
  lines: SalesOrderLinePayload[];
};

export type SalesOrderUpdatePayload = Partial<Omit<SalesOrderPayload, "lines">> & {
  lines?: SalesOrderLinePayload[];
};

export type StockReservation = {
  id: number;
  sales_order_id: number;
  sales_order_line_id: number;
  warehouse_id: number;
  product_id: number;
  batch_id: number | null;
  reserved_qty: string;
  consumed_qty: string;
  released_qty: string;
  status: StockReservationStatus;
  created_at: string;
  updated_at: string;
};

export type BatchAvailability = {
  batch_id: number;
  batch_no: string;
  expiry_date: string;
  qty_on_hand: string;
};

export type StockAvailability = {
  warehouse_id: number;
  product_id: number;
  on_hand_qty: string;
  reserved_qty: string;
  available_qty: string;
  candidate_batches: BatchAvailability[];
};

export type DispatchLine = {
  id: number;
  dispatch_note_id: number;
  sales_order_line_id: number;
  product_id: number;
  batch_id: number;
  expiry_date_snapshot: string | null;
  dispatched_qty: string;
  unit_price_snapshot: string;
  line_total: string;
};

export type DispatchNote = {
  id: number;
  dispatch_number: string;
  sales_order_id: number;
  customer_id: number;
  warehouse_id: number;
  status: DispatchNoteStatus;
  dispatch_date: string;
  remarks: string | null;
  created_by: number;
  posted_by: number | null;
  created_at: string;
  posted_at: string | null;
  lines: DispatchLine[];
};

export type DispatchLinePayload = {
  sales_order_line_id: number;
  batch_id: number;
  dispatched_qty: string;
};

export type DispatchNotePayload = {
  dispatch_date: string;
  remarks?: string;
  lines: DispatchLinePayload[];
};

export type GrnBatchLinePayload = {
  batch_id?: number | null;
  batch_no?: string;
  expiry_date?: string;
  mfg_date?: string;
  mrp?: string;
  received_qty: string;
  free_qty?: string;
  unit_cost?: string;
  remarks?: string;
};

export type GrnLinePayload = {
  po_line_id: number | null;
  purchase_bill_line_id?: number | null;
  received_qty: string;
  free_qty?: string;
  unit_cost?: string;
  batch_id?: number;
  batch_no?: string;
  expiry_date?: string;
  mfg_date?: string;
  mrp?: string;
  remarks?: string;
  batch_lines?: GrnBatchLinePayload[];
};

export type CreateGrnFromPoPayload = {
  received_date?: string;
  supplier_id?: number;
  warehouse_id?: number;
  purchase_bill_id?: number | null;
  remarks?: string;
  lines: GrnLinePayload[];
};

export type CreateGrnFromBillPayload = {
  purchase_order_id?: number | null;
  received_date?: string;
  supplier_id?: number;
  warehouse_id?: number;
  remarks?: string;
  lines: GrnLinePayload[];
};

export type UpdateGrnPayload = {
  purchase_bill_id?: number | null;
  received_date: string;
  remarks?: string;
  lines: GrnLinePayload[];
};

export type GrnListQuery = {
  search?: string;
  status?: string;
  supplier_id?: number;
  warehouse_id?: number;
  po_number?: string;
  bill_number?: string;
  grn_number?: string;
  date_from?: string;
  date_to?: string;
};

export type TestResetResponse = {
  ok: boolean;
  admin_email: string;
  seed_minimal: boolean;
};

export type StockSummaryLookup = {
  warehouse_id: number;
  product_id: number;
  batch_id: number;
  qty_on_hand: string;
};

export type PagedResponse<T> = {
  total: number;
  page: number;
  page_size: number;
  data: T[];
};

export type ExpiryReportRow = {
  product: string;
  batch: string;
  warehouse: string;
  expiry_date: string;
  days_to_expiry: number;
  current_qty: string;
  quantity_precision: number;
};

export type DeadStockReportRow = {
  product: string;
  warehouse: string;
  current_qty: string;
  last_movement_date: string | null;
  days_since_movement: number | null;
  quantity_precision: number;
};

export type StockAgeingReportRow = {
  product: string;
  warehouse: string;
  bucket_0_30: string;
  bucket_31_60: string;
  bucket_61_90: string;
  bucket_90_plus: string;
  total_qty: string;
  quantity_precision: number;
};

export type StockInwardReportRow = {
  grn_number: string;
  po_number: string;
  supplier_name: string;
  warehouse_name: string;
  product_name: string;
  batch_no: string;
  expiry_date: string;
  qty_received: string;
  free_qty: string;
  received_date: string;
  posted_by: string | null;
  quantity_precision: number;
};

export type PurchaseRegisterReportRow = {
  po_number: string;
  supplier: string;
  warehouse: string;
  order_date: string;
  status: PurchaseOrderStatus;
  total_order_qty: string;
  total_received_qty: string;
  pending_qty: string;
  total_value: string | null;
};

export type StockMovementReportRow = {
  transaction_date: string;
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  product: string;
  batch: string;
  warehouse: string;
  source_supplier: string | null;
  source_po: string | null;
  source_bill: string | null;
  source_grn: string | null;
  qty_in: string;
  qty_out: string;
  running_balance: string;
  quantity_precision: number;
};

export type CurrentStockReportRow = {
  product_id: number;
  sku: string;
  product_name: string;
  brand: string | null;
  category: string | null;
  warehouse_id: number;
  warehouse: string;
  batch_id: number;
  batch: string;
  expiry_date: string;
  available_qty: string;
  reserved_qty: string;
  stock_value: string;
  last_movement_date: string | null;
  quantity_precision: number;
};

export type CurrentStockSummary = {
  total_skus: number;
  total_stock_qty: string;
  total_stock_value: string;
  items_expiring_soon: number;
};

export type CurrentStockReportResponse = PagedResponse<CurrentStockReportRow> & {
  summary: CurrentStockSummary;
};

export type StockSourceTraceabilityReportRow = {
  product_id: number;
  warehouse_id: number;
  batch_id: number;
  product: string;
  sku: string;
  batch_no: string;
  expiry_date: string;
  warehouse: string;
  qty_on_hand: string;
  received_qty: string;
  free_qty: string;
  supplier_name: string;
  po_number: string;
  purchase_bill_number: string | null;
  grn_number: string;
  received_date: string;
  unit_cost: string | null;
  quantity_precision: number;
};

export type CurrentStockSourceDetailRow = {
  supplier_name: string;
  po_number: string;
  purchase_bill_number: string | null;
  grn_number: string;
  received_date: string;
  received_qty: string;
  free_qty: string;
  unit_cost: string | null;
  grn_line_id: number;
  grn_batch_line_id: number;
};

export type CurrentStockSourceDetailResponse = {
  product_id: number;
  warehouse_id: number;
  batch_id: number;
  sku: string;
  product_name: string;
  warehouse: string;
  batch_no: string;
  expiry_date: string;
  qty_on_hand: string;
  quantity_precision: number;
  sources: CurrentStockSourceDetailRow[];
};

export type OpeningStockReportRow = {
  sku: string;
  product_name: string;
  brand: string | null;
  category: string | null;
  warehouse: string;
  batch: string;
  expiry_date: string;
  opening_qty: string;
  opening_value: string;
  last_opening_date: string | null;
  current_qty: string;
  quantity_precision: number;
};

export type OpeningStockSummary = {
  total_skus: number;
  total_opening_qty: string;
  total_opening_value: string;
};

export type OpeningStockReportResponse = PagedResponse<OpeningStockReportRow> & {
  summary: OpeningStockSummary;
};

export type ReportEntityOption = {
  id: number;
  label: string;
};

export type ReportFilterOptions = {
  brands: string[];
  categories: string[];
  batches: string[];
  products: ReportEntityOption[];
  suppliers: ReportEntityOption[];
  warehouses: ReportEntityOption[];
};

export type MasterReportFilterOptions = ReportFilterOptions & {
  party_types: string[];
  party_categories: string[];
  states: string[];
  cities: string[];
};

export type DataQualityFilterOptions = {
  entity_types: string[];
  missing_field_types: string[];
  duplicate_types: string[];
  compliance_types: string[];
};

export type ReportSummaryMetric = {
  key: string;
  label: string;
  value: string | number | boolean | null;
};

export type GenericTabularReportResponse = {
  total: number;
  page: number;
  page_size: number;
  summary: ReportSummaryMetric[];
  data: Array<Record<string, string | number | boolean | null>>;
};

function toErrorMessage(errorBody: ApiError): string {
  if (typeof errorBody.detail === "string") {
    return errorBody.detail;
  }

  if (
    errorBody.detail &&
    !Array.isArray(errorBody.detail) &&
    typeof errorBody.detail.message === "string"
  ) {
    return errorBody.detail.message;
  }

  if (Array.isArray(errorBody.detail) && errorBody.detail.length > 0) {
    return errorBody.detail[0].msg ?? "Request failed";
  }

  return errorBody.message ?? "Request failed";
}

export class ApiRequestError extends Error {
  code?: string;
  details?: unknown;

  constructor(message: string, options?: { code?: string; details?: unknown }) {
    super(message);
    this.name = "ApiRequestError";
    this.code = options?.code;
    this.details = options?.details;
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    credentials: "include",
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as ApiError;
    const detailObject =
      errorBody.detail &&
      typeof errorBody.detail === "object" &&
      !Array.isArray(errorBody.detail)
        ? errorBody.detail
        : undefined;
    throw new ApiRequestError(toErrorMessage(errorBody), {
      code:
        errorBody.error_code ||
        detailObject?.error_code ||
        (response.status === 401 ? "UNAUTHORIZED" : undefined),
      details: errorBody.details || detailObject?.details,
    });
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}

function withQuery(
  path: string,
  query?: Record<string, string | number | boolean | undefined | null>,
) {
  if (!query) {
    return path;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export const apiClient = {
  login: (payload: LoginPayload) =>
    request<{ success: true }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getMe: () => request<AuthUser>("/api/auth/me", { method: "GET" }),
  getMyPreferences: () =>
    request<UserPreferences>("/api/users/me/preferences", { method: "GET" }),
  updateMyPreferences: (payload: UserPreferences) =>
    request<UserPreferences>("/api/users/me/preferences", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  logout: () =>
    request<{ success: true }>("/api/auth/logout", { method: "POST" }),

  getDashboardMetrics: () =>
    request<DashboardMetrics>("/api/dashboard/metrics", { method: "GET" }),

  getCompanySettings: () =>
    request<CompanySettings>("/api/settings/company", { method: "GET" }),
  updateCompanySettings: (payload: CompanySettingsPayload) =>
    request<CompanySettings>("/api/settings/company", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  listTaxRates: (includeInactive = false) =>
    request<TaxRate[]>(
      withQuery("/api/tax-rates", { include_inactive: includeInactive }),
      { method: "GET" },
    ),
  createTaxRate: (payload: TaxRatePayload) =>
    request<TaxRate>("/api/tax-rates", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateTaxRate: (id: number, payload: Partial<TaxRatePayload>) =>
    request<TaxRate>(`/api/tax-rates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deactivateTaxRate: (id: number) =>
    request<TaxRate>(`/api/tax-rates/${id}`, {
      method: "DELETE",
    }),
  listCategories: (includeInactive = false) =>
    request<Category[]>(
      withQuery("/api/masters/categories", { include_inactive: includeInactive }),
      { method: "GET" },
    ),
  createCategory: (payload: CategoryPayload) =>
    request<Category>("/api/masters/categories", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateCategory: (id: number, payload: Partial<CategoryPayload>) =>
    request<Category>(`/api/masters/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteCategory: (id: number) =>
    request<Category>(`/api/masters/categories/${id}`, {
      method: "DELETE",
    }),
  listBrands: (includeInactive = false) =>
    request<Brand[]>(
      withQuery("/api/masters/brands", { include_inactive: includeInactive }),
      { method: "GET" },
    ),
  createBrand: (payload: BrandPayload) =>
    request<Brand>("/api/masters/brands", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateBrand: (id: number, payload: Partial<BrandPayload>) =>
    request<Brand>(`/api/masters/brands/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteBrand: (id: number) =>
    request<Brand>(`/api/masters/brands/${id}`, {
      method: "DELETE",
    }),

  listParties: () =>
    request<Party[]>("/api/masters/parties", { method: "GET" }),
  createParty: (payload: PartyPayload) =>
    request<Party>("/api/masters/parties", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateParty: (id: number, payload: Partial<PartyPayload>) =>
    request<Party>(`/api/masters/parties/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deactivateParty: (id: number) =>
    request<Party>(`/api/masters/parties/${id}`, {
      method: "DELETE",
    }),
  bulkCreateParties: (payload: { rows?: Record<string, unknown>[]; csv_data?: string }) =>
    request<BulkImportResult>("/api/masters/parties/bulk", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listProducts: () =>
    request<Product[]>("/api/masters/products", { method: "GET" }),
  createProduct: (payload: ProductPayload) =>
    request<Product>("/api/masters/products", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateProduct: (id: number, payload: Partial<ProductPayload>) =>
    request<Product>(`/api/masters/products/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  bulkCreateItems: (payload: { rows?: Record<string, unknown>[]; csv_data?: string }) =>
    request<BulkImportResult>("/api/masters/items/bulk", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listWarehouses: (includeInactive = false) =>
    request<Warehouse[]>(
      withQuery("/api/masters/warehouses", {
        include_inactive: includeInactive ? "true" : undefined,
      }),
      { method: "GET" },
    ),
  createWarehouse: (payload: WarehousePayload) =>
    request<Warehouse>("/api/masters/warehouses", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateWarehouse: (id: number, payload: Partial<WarehousePayload>) =>
    request<Warehouse>(`/api/masters/warehouses/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteWarehouse: (id: number) =>
    request<WarehouseDeleteResult>(`/api/masters/warehouses/${id}`, {
      method: "DELETE",
    }),
  bulkDeleteWarehouses: (ids: number[]) =>
    request<WarehouseBulkDeleteResult>("/api/masters/warehouses/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  bulkUploadOpeningStock: (payload: { rows?: Record<string, unknown>[]; csv_data?: string }) =>
    request<BulkImportResult>("/api/inventory/opening-stock/bulk", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getInventoryStockItems: (
    query?: Record<string, string | number | undefined | null>,
  ) =>
    request<InventoryStockItemListResponse>(
      withQuery("/api/inventory/stock-items", query),
      {
        method: "GET",
      },
    ),
  createStockCorrection: (payload: StockCorrectionPayload) =>
    request<StockCorrectionResponse>("/api/inventory/stock-corrections", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listStockCorrections: (
    query?: Record<string, string | number | undefined | null>,
  ) =>
    request<StockCorrectionListResponse>(
      withQuery("/api/inventory/stock-corrections", query),
      { method: "GET" },
    ),
  createStockAdjustment: (payload: StockAdjustmentPayload) =>
    request<StockAdjustmentResponse>("/api/inventory/stock-adjustments", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listStockAdjustments: (
    query?: Record<string, string | number | undefined | null>,
  ) =>
    request<StockAdjustmentListResponse>(
      withQuery("/api/inventory/stock-adjustments", query),
      { method: "GET" },
    ),
  listSalesOrders: () =>
    request<{ items: SalesOrder[] }>("/api/sales-orders", { method: "GET" }),
  getSalesOrder: (id: number) =>
    request<SalesOrder>(`/api/sales-orders/${id}`, { method: "GET" }),
  createSalesOrder: (payload: SalesOrderPayload) =>
    request<SalesOrder>("/api/sales-orders", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateSalesOrder: (id: number, payload: SalesOrderUpdatePayload) =>
    request<SalesOrder>(`/api/sales-orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  confirmSalesOrder: (id: number) =>
    request<SalesOrder>(`/api/sales-orders/${id}/confirm`, {
      method: "POST",
    }),
  cancelSalesOrder: (id: number) =>
    request<SalesOrder>(`/api/sales-orders/${id}/cancel`, {
      method: "POST",
    }),
  listReservations: (query?: Record<string, string | number | undefined | null>) =>
    request<{ items: StockReservation[] }>(withQuery("/api/reservations", query), {
      method: "GET",
    }),
  getStockAvailability: (warehouseId: number, productId: number) =>
    request<StockAvailability>(
      withQuery("/api/reservations/availability", {
        warehouse_id: warehouseId,
        product_id: productId,
      }),
      { method: "GET" },
    ),
  listDispatchNotes: () =>
    request<{ items: DispatchNote[] }>("/api/dispatch-notes", { method: "GET" }),
  getDispatchNote: (id: number) =>
    request<DispatchNote>(`/api/dispatch-notes/${id}`, { method: "GET" }),
  createDispatchFromSalesOrder: (salesOrderId: number, payload: DispatchNotePayload) =>
    request<DispatchNote>(`/api/dispatch-notes/from-sales-order/${salesOrderId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  postDispatchNote: (id: number) =>
    request<DispatchNote>(`/api/dispatch-notes/${id}/post`, {
      method: "POST",
    }),
  cancelDispatchNote: (id: number) =>
    request<DispatchNote>(`/api/dispatch-notes/${id}/cancel`, {
      method: "POST",
    }),
  listAuditLogs: (query?: Record<string, string | number | undefined | null>) =>
    request<AuditLogListResponse>(withQuery("/api/settings/audit-trail", query), {
      method: "GET",
    }),
  getAuditLog: (id: string) =>
    request<AuditLogDetail>(`/api/settings/audit-trail/${id}`, {
      method: "GET",
    }),
  getRecordHistory: (entityType: string, entityId: number) =>
    request<RecordHistoryResponse>(`/api/settings/history/${entityType}/${entityId}`, {
      method: "GET",
    }),

  listPurchaseOrders: (query?: PurchaseOrderListQuery) =>
    request<{ items: PurchaseOrder[] }>(withQuery("/api/purchase/po", query), { method: "GET" }),
  getPurchaseOrder: (id: number) =>
    request<PurchaseOrder>(`/api/purchase/po/${id}`, { method: "GET" }),
  createPurchaseOrder: (payload: PurchaseOrderPayload) =>
    request<PurchaseOrder>("/api/purchase/po", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updatePurchaseOrder: (id: number, payload: PurchaseOrderPayload) =>
    request<PurchaseOrder>(`/api/purchase/po/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  cancelPurchaseOrder: (id: number) =>
    request<PurchaseOrder>(`/api/purchase/po/${id}/cancel`, {
      method: "POST",
    }),
  listPurchaseBills: () =>
    request<{ items: PurchaseBill[] }>("/api/purchase-bills", { method: "GET" }),
  getPurchaseBill: (billId: number) =>
    request<PurchaseBill>(`/api/purchase-bills/${billId}`, { method: "GET" }),
  uploadPurchaseBill: async (file: File, warehouseId?: number) => {
    const formData = new FormData();
    formData.append("file", file);
    if (warehouseId !== undefined) {
      formData.append("warehouse_id", String(warehouseId));
    }

    const response = await fetch("/api/purchase-bills/upload", {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as ApiError;
      throw new ApiRequestError(toErrorMessage(errorBody), {
        code: errorBody.error_code,
        details: errorBody.details,
      });
    }

    return (await response.json()) as PurchaseBill;
  },
  updatePurchaseBill: (billId: number, payload: PurchaseBillUpdatePayload) =>
    request<PurchaseBill>(`/api/purchase-bills/${billId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  verifyPurchaseBill: (billId: number) =>
    request<PurchaseBill>(`/api/purchase-bills/${billId}/verify`, {
      method: "POST",
    }),
  postPurchaseBill: (billId: number) =>
    request<PurchaseBill>(`/api/purchase-bills/${billId}/post`, {
      method: "POST",
    }),
  cancelPurchaseBill: (billId: number) =>
    request<PurchaseBill>(`/api/purchase-bills/${billId}/cancel`, {
      method: "POST",
    }),
  approvePurchaseOrder: (id: number) =>
    request<PurchaseOrder>(`/api/purchase/po/${id}/approve`, {
      method: "POST",
    }),

  listGrns: (query?: GrnListQuery) =>
    request<Grn[]>(withQuery("/api/purchase/grn", query), { method: "GET" }),
  getGrn: (id: number) =>
    request<Grn>(`/api/purchase/grn/${id}`, { method: "GET" }),
  createGrnFromPo: (poId: number, payload: CreateGrnFromPoPayload) =>
    request<Grn>(`/api/purchase/grn/from-po/${poId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  createGrnFromBill: (billId: number, payload: CreateGrnFromBillPayload) =>
    request<Grn>(`/api/purchase/grn/from-bill/${billId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateGrn: (id: number, payload: UpdateGrnPayload) =>
    request<Grn>(`/api/purchase/grn/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  postGrn: (id: number) =>
    request<Grn>(`/api/purchase/grn/${id}/post`, {
      method: "POST",
    }),
  cancelGrn: (id: number) =>
    request<Grn>(`/api/purchase/grn/${id}/cancel`, {
      method: "POST",
    }),
  attachBillToGrn: (id: number, purchaseBillId: number) =>
    request<Grn>(`/api/purchase/grn/${id}/attach-bill`, {
      method: "POST",
      body: JSON.stringify({ purchase_bill_id: purchaseBillId }),
    }),
  listPurchaseCreditNotes: () =>
    request<PurchaseCreditNote[]>("/api/purchase-credit-notes", {
      method: "GET",
    }),

  getStockInwardReport: (query?: Record<string, string | number | boolean | undefined | null>) =>
    request<PagedResponse<StockInwardReportRow>>(withQuery("/api/reports/stock-inward", query), {
      method: "GET",
    }),
  getPurchaseRegisterReport: (query?: Record<string, string | number | boolean | undefined | null>) =>
    request<PagedResponse<PurchaseRegisterReportRow>>(withQuery("/api/reports/purchase-register", query), {
      method: "GET",
    }),
  getStockMovementReport: (query?: Record<string, string | number | boolean | undefined | null>) =>
    request<PagedResponse<StockMovementReportRow>>(withQuery("/api/reports/stock-movement", query), {
      method: "GET",
    }),
  getExpiryReport: (query?: Record<string, string | number | boolean | undefined | null>) =>
    request<PagedResponse<ExpiryReportRow>>(withQuery("/api/reports/expiry", query), {
      method: "GET",
    }),
  getDeadStockReport: (query?: Record<string, string | number | boolean | undefined | null>) =>
    request<PagedResponse<DeadStockReportRow>>(withQuery("/api/reports/dead-stock", query), {
      method: "GET",
    }),
  getStockAgeingReport: (query?: Record<string, string | number | boolean | undefined | null>) =>
    request<PagedResponse<StockAgeingReportRow>>(withQuery("/api/reports/stock-ageing", query), {
      method: "GET",
    }),
  getCurrentStockReport: (query?: Record<string, string | number | boolean | undefined | null>) =>
    request<CurrentStockReportResponse>(withQuery("/api/reports/current-stock", query), {
      method: "GET",
    }),
  getCurrentStockSourceDetail: (query: {
    warehouse_id: number;
    product_id: number;
    batch_id: number;
  }) =>
    request<CurrentStockSourceDetailResponse>(
      withQuery("/api/reports/current-stock/source-details", query),
      {
        method: "GET",
      },
    ),
  getOpeningStockReport: (query?: Record<string, string | number | boolean | undefined | null>) =>
    request<OpeningStockReportResponse>(withQuery("/api/reports/opening-stock", query), {
      method: "GET",
    }),
  getStockSourceTraceabilityReport: (
    query?: Record<string, string | number | boolean | undefined | null>,
  ) =>
    request<PagedResponse<StockSourceTraceabilityReportRow>>(
      withQuery("/api/reports/stock-source-traceability", query),
      {
        method: "GET",
      },
    ),
  getReportFilterOptions: () =>
    request<ReportFilterOptions>("/api/reports/filter-options", { method: "GET" }),
  getMasterReportFilterOptions: () =>
    request<MasterReportFilterOptions>("/api/reports/masters/filter-options", { method: "GET" }),
  getDataQualityFilterOptions: () =>
    request<DataQualityFilterOptions>("/api/reports/data-quality/filter-options", { method: "GET" }),
  getGenericReport: (
    path: string,
    query?: Record<string, string | number | boolean | undefined | null>,
  ) =>
    request<GenericTabularReportResponse>(withQuery(path, query), {
      method: "GET",
    }),
  listUsers: () =>
    request<{ items: ManagedUser[] }>("/api/users", { method: "GET" }),
  listUserRoleOptions: () =>
    request<{ items: ManagedRole[] }>("/api/users/role-options", { method: "GET" }),
  createUser: (payload: ManagedUserCreatePayload) =>
    request<ManagedUser>("/api/users", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  testResetAndSeed: (seed_minimal = true) =>
    request<TestResetResponse>("/api/test/reset-and-seed", {
      method: "POST",
      body: JSON.stringify({ seed_minimal }),
    }),
  getTestStockSummary: (query: Record<string, string | number>) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) =>
      params.set(key, String(value)),
    );
    return request<StockSummaryLookup>(
      `/api/test/stock-summary?${params.toString()}`,
      {
        method: "GET",
      },
    );
  },
};
