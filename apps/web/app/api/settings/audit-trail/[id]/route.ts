import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  return proxyWithAuth({
    path: `/settings/audit-trail/${id}`,
    method: "GET",
  });
}
