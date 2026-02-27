import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

type RouteContext = {
  params: Promise<{ po_id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { po_id } = await context.params;
  const payload = await request.json();

  return proxyWithAuth({
    path: `/purchase/grn/from-po/${po_id}`,
    method: "POST",
    body: payload,
  });
}
