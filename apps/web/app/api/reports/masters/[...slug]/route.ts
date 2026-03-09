import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

type RouteContext = {
  params: Promise<{ slug: string[] }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  const query = request.nextUrl.searchParams.toString();
  const suffix = query ? `?${query}` : "";

  return proxyWithAuth({
    path: `/reports/masters/${slug.join("/")}${suffix}`,
    method: "GET",
  });
}
