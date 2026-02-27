import { NextRequest } from "next/server";

import { proxyWithoutAuth } from "@/app/api/_lib/backend";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => ({ seed_minimal: true }));

  return proxyWithoutAuth({
    path: "/test/reset-and-seed",
    method: "POST",
    body: payload,
  });
}
