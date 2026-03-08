import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

export async function GET(request: NextRequest) {
  return proxyWithAuth({
    path: `/settings/audit-trail${request.nextUrl.search}`,
    method: "GET",
  });
}
