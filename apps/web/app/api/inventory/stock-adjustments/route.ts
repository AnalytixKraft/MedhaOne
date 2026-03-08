import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

export async function GET(request: NextRequest) {
  return proxyWithAuth({
    path: `/inventory/stock-adjustments${request.nextUrl.search}`,
    method: "GET",
  });
}

export async function POST(request: NextRequest) {
  const payload = await request.json();

  return proxyWithAuth({
    path: "/inventory/stock-adjustments",
    method: "POST",
    body: payload,
  });
}
