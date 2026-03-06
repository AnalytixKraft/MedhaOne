import { proxyWithAuth } from "@/app/api/_lib/backend";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));

  return proxyWithAuth({
    path: `/tax-rates/${id}`,
    method: "PATCH",
    body,
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return proxyWithAuth({
    path: `/tax-rates/${id}`,
    method: "DELETE",
  });
}
