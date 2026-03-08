import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

type RouteProps = {
  params: Promise<{ entityType: string; entityId: string }>;
};

export async function GET(_request: NextRequest, { params }: RouteProps) {
  const { entityType, entityId } = await params;
  return proxyWithAuth({
    path: `/settings/history/${entityType}/${entityId}`,
    method: "GET",
  });
}
