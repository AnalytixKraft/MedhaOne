import { proxyWithAuthRaw } from "@/app/api/_lib/backend";

export async function GET() {
  return proxyWithAuthRaw({
    path: "/inventory/templates/opening-stock-import.csv",
    method: "GET",
  });
}
