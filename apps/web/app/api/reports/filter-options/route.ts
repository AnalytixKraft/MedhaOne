import { proxyWithAuth } from "@/app/api/_lib/backend";

export async function GET() {
  return proxyWithAuth({
    path: "/reports/filter-options",
    method: "GET",
  });
}
