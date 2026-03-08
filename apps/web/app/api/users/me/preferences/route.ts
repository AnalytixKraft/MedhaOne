import { proxyWithAuth } from "@/app/api/_lib/backend";

export async function GET() {
  return proxyWithAuth({
    path: "/users/me/preferences",
    method: "GET",
  });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  return proxyWithAuth({
    path: "/users/me/preferences",
    method: "PATCH",
    body,
  });
}
