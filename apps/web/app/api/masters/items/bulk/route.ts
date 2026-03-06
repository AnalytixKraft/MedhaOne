import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

export async function POST(request: NextRequest) {
  const payload = await request.json();

  return proxyWithAuth({
    path: "/masters/items/bulk",
    method: "POST",
    body: payload,
  });
}
