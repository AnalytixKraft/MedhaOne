import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const TOKEN_COOKIE = "medhaone_token";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:1730";

type ProxyOptions = {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
};

export async function proxyWithAuth({ path, method, body }: ProxyOptions): Promise<NextResponse> {
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
