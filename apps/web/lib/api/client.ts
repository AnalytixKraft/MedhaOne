export type ApiError = {
  detail?: string;
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
    throw new Error(errorBody.detail ?? errorBody.message ?? "Request failed");
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
};
