import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.toString();
  const suffix = query ? `?${query}` : "";

  return proxyWithAuth({
    path: `/users${suffix}`,
    method: "GET",
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  return proxyWithAuth({
    path: "/users",
    method: "POST",
    body,
  });
}
