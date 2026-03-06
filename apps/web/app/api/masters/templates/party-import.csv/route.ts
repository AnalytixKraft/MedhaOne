import { proxyWithAuthRaw } from "@/app/api/_lib/backend";

export async function GET() {
  return proxyWithAuthRaw({
    path: "/masters/templates/party-import.csv",
    method: "GET",
  });
}
