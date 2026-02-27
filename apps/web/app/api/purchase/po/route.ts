import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.toString();
  const suffix = query ? `?${query}` : "";

  return proxyWithAuth({
    path: `/purchase/po${suffix}`,
    method: "GET",
  });
}

export async function POST(request: NextRequest) {
  const payload = await request.json();

  return proxyWithAuth({
    path: "/purchase/po",
    method: "POST",
    body: payload,
  });
}
