import { APIRequestContext, expect } from "@playwright/test";

const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://localhost:1730";

type StockSummaryParams = {
  warehouse_id?: number;
  product_id?: number;
  batch_id?: number;
  warehouse_code?: string;
  product_sku?: string;
  batch_no?: string;
  expiry_date?: string;
};

export async function resetAndSeed(
  request: APIRequestContext,
  seedMinimal = false,
): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/test/reset-and-seed`, {
    data: { seed_minimal: seedMinimal },
  });

  if (!response.ok()) {
    const text = await response.text();
    throw new Error(
      `Failed to reset and seed test DB (${response.status()}): ${text}`,
    );
  }
}

export async function expectStockQty(
  request: APIRequestContext,
  params: StockSummaryParams,
  expectedQty: string,
): Promise<void> {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      search.set(key, String(value));
    }
  });

  const response = await request.get(
    `${API_BASE_URL}/test/stock-summary?${search.toString()}`,
  );
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as { qty_on_hand: string };
  expect(String(payload.qty_on_hand)).toBe(expectedQty);
}
