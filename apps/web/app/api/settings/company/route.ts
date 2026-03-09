import { proxyWithAuth } from "@/app/api/_lib/backend";

export async function GET() {
  return proxyWithAuth({
    path: "/settings/company",
    method: "GET",
  });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  return proxyWithAuth({
    path: "/settings/company",
    method: "PUT",
    body,
  });
}

export async function PATCH(request: Request) {
  return PUT(request);
}
