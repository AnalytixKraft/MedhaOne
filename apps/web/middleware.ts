import { NextRequest, NextResponse } from "next/server";

const TOKEN_COOKIE = "medhaone_token";

const protectedRoutes = ["/dashboard", "/masters", "/purchase", "/sales", "/warehouse", "/reports", "/settings"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(TOKEN_COOKIE)?.value;

  const isProtected = protectedRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));

  if (isProtected && !token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname === "/login" && token) {
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
