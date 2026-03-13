import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

type RouteContext = {
  params: Promise<{ logId: string }>;
};

export async function GET(_: NextRequest, context: RouteContext) {
  const { logId } = await context.params;

  return proxyWithAuth({
    path: `/masters/drug-license-verification/history/${logId}`,
    method: "GET",
  });
}
