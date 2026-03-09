import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

type RouteContext = {
  params: Promise<{ bill_id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { bill_id } = await context.params;
  const payload = await request.json();

  return proxyWithAuth({
    path: `/purchase/grn/from-bill/${bill_id}`,
    method: "POST",
    body: payload,
  });
}
