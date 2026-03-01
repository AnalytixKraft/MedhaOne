import { proxyWithoutAuth } from "@/app/api/_lib/backend";

export async function GET() {
  return proxyWithoutAuth({
    path: "/test/ledger-grn-duplicates",
    method: "GET",
  });
}

