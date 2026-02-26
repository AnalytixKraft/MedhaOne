export type ApiError = {
  detail?: string | { msg?: string }[];
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

function toErrorMessage(errorBody: ApiError): string {
  if (typeof errorBody.detail === "string") {
    return errorBody.detail;
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
  logout: () => request<{ success: true }>("/api/auth/logout", { method: "POST" }),

  getDashboardMetrics: () => request<DashboardMetrics>("/api/dashboard/metrics", { method: "GET" }),

  listParties: () => request<Party[]>("/api/masters/parties", { method: "GET" }),
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

  listProducts: () => request<Product[]>("/api/masters/products", { method: "GET" }),
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

  listWarehouses: () => request<Warehouse[]>("/api/masters/warehouses", { method: "GET" }),
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
};
