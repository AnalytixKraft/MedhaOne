import { proxyWithAuth } from "@/app/api/_lib/backend";

export async function GET() {
  return proxyWithAuth({
    path: "/reports/data-quality/filter-options",
    method: "GET",
  });
}
