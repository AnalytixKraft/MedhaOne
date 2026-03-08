import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyWithAuth({
    path: `/sales-orders/${id}`,
    method: "GET",
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const payload = await request.json();
  return proxyWithAuth({
    path: `/sales-orders/${id}`,
    method: "PATCH",
    body: payload,
  });
}
