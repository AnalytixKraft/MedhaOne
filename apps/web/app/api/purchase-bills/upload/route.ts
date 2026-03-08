import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const TOKEN_COOKIE = "medhaone_token";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:1730";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const incomingFormData = await request.formData();
  const outboundFormData = new FormData();
  for (const [key, value] of incomingFormData.entries()) {
    outboundFormData.append(key, value);
  }

  const response = await fetch(`${API_BASE_URL}/purchase-bills/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: outboundFormData,
    cache: "no-store",
  });

  const raw = await response.text();
  if (!raw) {
    return new NextResponse(null, { status: response.status });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { detail: raw };
  }

  return NextResponse.json(payload, { status: response.status });
}
