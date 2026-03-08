import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const TOKEN_COOKIE = "medhaone_token";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:1730";

type RouteContext = {
  params: Promise<{ attachmentId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { attachmentId } = await context.params;
  const response = await fetch(`${API_BASE_URL}/purchase-bills/attachments/${attachmentId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  const buffer = await response.arrayBuffer();
  const headers = new Headers();
  const contentType = response.headers.get("content-type");
  const contentDisposition = response.headers.get("content-disposition");
  if (contentType) {
    headers.set("content-type", contentType);
  }
  if (contentDisposition) {
    headers.set("content-disposition", contentDisposition);
  }
  return new NextResponse(buffer, { status: response.status, headers });
}
