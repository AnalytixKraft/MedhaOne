import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.search;
  return proxyWithAuth({
    path: `/purchase/grn${search}`,
    method: "GET",
  });
}
