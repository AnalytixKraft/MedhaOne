import { NextRequest } from "next/server";

import { proxyWithAuth } from "@/app/api/_lib/backend";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  return proxyWithAuth({
    path: `/masters/parties/${id}`,
    method: "GET",
  });
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const payload = await request.json();

  return proxyWithAuth({
    path: `/masters/parties/${id}`,
    method: "PUT",
    body: payload,
  });
}

export async function DELETE(_: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  return proxyWithAuth({
    path: `/masters/parties/${id}`,
    method: "DELETE",
  });
}
