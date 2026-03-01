import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const TOKEN_COOKIE = "medhaone_token";

export async function POST(request: NextRequest) {
  const { email, password, organization_slug } = (await request.json()) as {
    email?: string;
    password?: string;
    organization_slug?: string;
  };

  if (!email || !password) {
    return NextResponse.json({ detail: "Email and password are required" }, { status: 400 });
  }

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:1730";
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const userAgent = request.headers.get("user-agent");

  const response = await fetch(`${apiBaseUrl}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
      ...(realIp ? { "x-real-ip": realIp } : {}),
      ...(userAgent ? { "user-agent": userAgent } : {}),
    },
    body: JSON.stringify({ email, password, organization_slug }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    detail?: string;
    error_code?: string;
    message?: string;
    details?: unknown;
  };

  if (!response.ok || !payload.access_token) {
    return NextResponse.json(
      {
        error_code: payload.error_code,
        message: payload.detail ?? payload.message ?? "Login failed",
        details: payload.details,
      },
      { status: response.status || 401 },
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(TOKEN_COOKIE, payload.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return NextResponse.json({ success: true });
}
