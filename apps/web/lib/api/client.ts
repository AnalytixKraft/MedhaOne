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

export type AuthUser = {
  id: number;
  email: string;
  full_name: string;
  is_active: boolean;
  is_superuser: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  role: Role | null;
  roles: Role[];
  permissions: string[];
};

export type PartyType =
  | "MANUFACTURER"
  | "SUPER_STOCKIST"
  | "DISTRIBUTOR"
  | "HOSPITAL"
  | "PHARMACY"
  | "RETAILER"
  | "CONSUMER";

export type Party = {
  id: number;
  name: string;
  party_type: PartyType;
  phone: string | null;
  email: string | null;
  address: string | null;
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

export type Product = {
  id: number;
  sku: string;
  name: string;
  brand: string | null;
  uom: string;
  barcode: string | null;
  hsn: string | null;
  gst_rate: string | null;
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

export type PartyPayload = {
  name: string;
  party_type: PartyType;
  phone?: string;
  email?: string;
  address?: string;
  is_active: boolean;
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
  ordered_qty: string;
  received_qty: string;
  unit_cost: string | null;
  free_qty: string;
  line_notes: string | null;
};

export type PurchaseOrder = {
  id: number;
  po_number: string;
  supplier_id: number;
  warehouse_id: number;
  status: PurchaseOrderStatus;
  order_date: string;
  expected_date: string | null;
  notes: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  lines: PurchaseOrderLine[];
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
  lines: PurchaseOrderLinePayload[];
};

export type GrnLine = {
  id: number;
  grn_id: number;
  po_line_id: number;
  product_id: number;
  batch_id: number;
  received_qty: string;
  free_qty: string;
  unit_cost: string | null;
  expiry_date: string;
};

export type Grn = {
  id: number;
  grn_number: string;
  purchase_order_id: number;
  supplier_id: number;
  warehouse_id: number;
  status: GrnStatus;
  received_date: string;
  posted_at: string | null;
  posted_by: number | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  lines: GrnLine[];
};

export type GrnLinePayload = {
  po_line_id: number;
  received_qty: string;
  free_qty?: string;
  unit_cost?: string;
  batch_id?: number;
  batch_no?: string;
  expiry_date?: string;
};

export type CreateGrnFromPoPayload = {
  received_date?: string;
  supplier_id?: number;
  warehouse_id?: number;
  lines: GrnLinePayload[];
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
  qty_in: string;
  qty_out: string;
  running_balance: string;
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
      code: errorBody.error_code || detailObject?.error_code,
      details: errorBody.details || detailObject?.details,
    });
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
}

function withQuery(path: string, query?: Record<string, string | number | undefined | null>) {
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
  logout: () =>
    request<{ success: true }>("/api/auth/logout", { method: "POST" }),

  getDashboardMetrics: () =>
    request<DashboardMetrics>("/api/dashboard/metrics", { method: "GET" }),

  listParties: () =>
    request<Party[]>("/api/masters/parties", { method: "GET" }),
  createParty: (payload: PartyPayload) =>
    request<Party>("/api/masters/parties", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateParty: (id: number, payload: Partial<PartyPayload>) =>
    request<Party>(`/api/masters/parties/${id}`, {
      method: "PUT",
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

  listWarehouses: () =>
    request<Warehouse[]>("/api/masters/warehouses", { method: "GET" }),
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

  listPurchaseOrders: () =>
    request<{ items: PurchaseOrder[] }>("/api/purchase/po", { method: "GET" }),
  getPurchaseOrder: (id: number) =>
    request<PurchaseOrder>(`/api/purchase/po/${id}`, { method: "GET" }),
  createPurchaseOrder: (payload: PurchaseOrderPayload) =>
    request<PurchaseOrder>("/api/purchase/po", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  approvePurchaseOrder: (id: number) =>
    request<PurchaseOrder>(`/api/purchase/po/${id}/approve`, {
      method: "POST",
    }),

  listGrns: () => request<Grn[]>("/api/purchase/grn", { method: "GET" }),
  getGrn: (id: number) =>
    request<Grn>(`/api/purchase/grn/${id}`, { method: "GET" }),
  createGrnFromPo: (poId: number, payload: CreateGrnFromPoPayload) =>
    request<Grn>(`/api/purchase/grn/from-po/${poId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  postGrn: (id: number) =>
    request<Grn>(`/api/purchase/grn/${id}/post`, {
      method: "POST",
    }),

  getStockInwardReport: (query?: Record<string, string | number | undefined | null>) =>
    request<PagedResponse<StockInwardReportRow>>(withQuery("/api/reports/stock-inward", query), {
      method: "GET",
    }),
  getPurchaseRegisterReport: (query?: Record<string, string | number | undefined | null>) =>
    request<PagedResponse<PurchaseRegisterReportRow>>(withQuery("/api/reports/purchase-register", query), {
      method: "GET",
    }),
  getStockMovementReport: (query?: Record<string, string | number | undefined | null>) =>
    request<PagedResponse<StockMovementReportRow>>(withQuery("/api/reports/stock-movement", query), {
      method: "GET",
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
