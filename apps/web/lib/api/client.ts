export type ApiError = {
  detail?:
    | string
    | {
        error_code?: string;
        message?: string;
      }
    | { msg?: string }[];
  message?: string;
};

export type LoginPayload = {
  email: string;
  password: string;
};

export type Role = {
  id: number;
  name: string;
};

export type AuthUser = {
  id: number;
  email: string;
  full_name: string;
  is_active: boolean;
  role: Role;
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
    throw new Error(toErrorMessage(errorBody));
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
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
