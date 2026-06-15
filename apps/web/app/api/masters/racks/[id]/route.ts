import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  return proxyWithAuth({
    path: `/masters/racks/${id}`,
    method: "GET",
  });
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const payload = await request.json();

  return proxyWithAuth({
    path: `/masters/racks/${id}`,
    method: "PUT",
    body: payload,
  });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  return proxyWithAuth({
    path: `/masters/racks/${id}`,
    method: "DELETE",
  });
}
