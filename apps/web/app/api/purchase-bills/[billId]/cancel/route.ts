import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

type RouteContext = {
  params: Promise<{ billId: string }>;
};

export async function POST(_request: NextRequest, context: RouteContext) {
  const { billId } = await context.params;
  return proxyWithAuth({
    path: `/purchase-bills/${billId}/cancel`,
    method: "POST",
  });
}
