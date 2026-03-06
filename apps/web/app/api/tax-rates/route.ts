import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.toString();
  const suffix = query ? `?${query}` : "";
  return proxyWithAuth({
    path: `/tax-rates${suffix}`,
    method: "GET",
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return proxyWithAuth({
    path: "/tax-rates",
    method: "POST",
    body,
  });
}
