import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

type RouteContext = {
  params: Promise<{ billId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { billId } = await context.params;
  return proxyWithAuth({
    path: `/purchase-bills/${billId}`,
    method: "GET",
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const payload = await request.json();
  const { billId } = await context.params;
  return proxyWithAuth({
    path: `/purchase-bills/${billId}`,
    method: "PATCH",
    body: payload,
  });
}
