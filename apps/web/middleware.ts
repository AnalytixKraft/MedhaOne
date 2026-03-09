import { NextRequest, NextResponse } from "next/server";

const TOKEN_COOKIE = "medhaone_token";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:1730";

const protectedRoutes = ["/dashboard", "/masters", "/purchase", "/sales", "/warehouse", "/reports", "/settings"];

async function isTokenValid(token: string) {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    return response.ok;
  } catch {
    // Do not turn middleware into an availability dependency for the app shell.
    return true;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(TOKEN_COOKIE)?.value;

  const isProtected = protectedRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));

  if (isProtected && !token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (!token) {
    return NextResponse.next();
  }

  const valid = await isTokenValid(token);

  if (!valid && isProtected) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(TOKEN_COOKIE);
    return response;
  }

  if (!valid) {
    const response = NextResponse.next();
    response.cookies.delete(TOKEN_COOKIE);
    return response;
  }

  if (pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/masters/:path*",
    "/purchase/:path*",
    "/sales/:path*",
    "/warehouse/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/login",
  ],
};
