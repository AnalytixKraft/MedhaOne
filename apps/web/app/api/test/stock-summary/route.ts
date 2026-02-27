import { NextRequest } from "next/server";

import { proxyWithoutAuth } from "@/app/api/_lib/backend";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.toString();
  const suffix = query ? `?${query}` : "";

  return proxyWithoutAuth({
    path: `/test/stock-summary${suffix}`,
    method: "GET",
  });
}
