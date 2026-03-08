import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const payload = await request.json();
  return proxyWithAuth({
    path: `/dispatch-notes/from-sales-order/${id}`,
    method: "POST",
    body: payload,
  });
}
