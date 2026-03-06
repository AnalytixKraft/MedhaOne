import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const TOKEN_COOKIE = "medhaone_token";
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:1730";

type ProxyOptions = {
  path: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
};

type RawProxyOptions = {
  path: string;
  method: "GET" | "POST";
  body?: string;
  contentType?: string;
};

type PublicProxyOptions = {
  path: string;
  method: "GET" | "POST";
  body?: unknown;
};

export async function proxyWithAuth({
  path,
  method,
  body,
}: ProxyOptions): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

export async function proxyWithoutAuth({
  path,
  method,
  body,
}: PublicProxyOptions): Promise<NextResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

export async function proxyWithAuthRaw({
  path,
  method,
  body,
  contentType,
}: RawProxyOptions): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(TOKEN_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body,
    cache: "no-store",
  });

  const raw = await response.text();
  const headers = new Headers();
  const upstreamContentType = response.headers.get("content-type");
  const upstreamDisposition = response.headers.get("content-disposition");
  if (upstreamContentType) {
    headers.set("content-type", upstreamContentType);
  }
  if (upstreamDisposition) {
    headers.set("content-disposition", upstreamDisposition);
  }
  return new NextResponse(raw, { status: response.status, headers });
}
