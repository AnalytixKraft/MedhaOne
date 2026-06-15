import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

type RouteContext = {
  params: Promise<{ logId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { logId } = await context.params;
  const payload = await request.json();

  return proxyWithAuth({
    path: `/masters/drug-license-verification/${logId}/resume`,
    method: "POST",
    body: payload,
  });
}
