import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

type RouteContext = {
  params: Promise<{ logId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { logId } = await context.params;

  return proxyWithAuth({
    path: `/masters/gst-verification/history/${logId}`,
    method: "GET",
  });
}
