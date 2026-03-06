import { proxyWithAuthRaw } from "@/app/api/_lib/backend";

export async function GET() {
  return proxyWithAuthRaw({
    path: "/masters/templates/item-import.csv",
    method: "GET",
  });
}
