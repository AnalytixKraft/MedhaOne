import { NextRequest } from "next/server";

import { proxyWithAuthRaw } from "@/app/api/_lib/backend";

export async function GET(request: NextRequest) {
  return proxyWithAuthRaw({
    path: `/settings/audit-trail/export${request.nextUrl.search}`,
    method: "GET",
  });
}
