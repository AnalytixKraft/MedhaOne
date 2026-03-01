import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.toString();
  const suffix = query ? `?${query}` : "";

  return proxyWithAuth({
    path: `/reports/stock-movement${suffix}`,
    method: "GET",
  });
}
