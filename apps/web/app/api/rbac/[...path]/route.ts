import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const RBAC_API_BASE_URL =
  process.env.NEXT_PUBLIC_RBAC_API_BASE_URL ?? "http://localhost:1740";
const TOKEN_COOKIE = "medhaone_token";

async function proxy(request: Request, path: string[]) {
  const requestUrl = new URL(request.url);
  const target = `${RBAC_API_BASE_URL}/${path.join("/")}${requestUrl.search}`;
  const contentType = request.headers.get("content-type");
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(TOKEN_COOKIE)?.value;
  const authorization =
    request.headers.get("authorization") ??
    (cookieToken ? `Bearer ${cookieToken}` : null);

  let response: Response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers: {
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.text(),
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown RBAC proxy failure";
    return NextResponse.json(
      {
        error_code: "RBAC_SERVICE_UNAVAILABLE",
        message: `RBAC service is unavailable at ${RBAC_API_BASE_URL}`,
        details: message,
      },
      { status: 502 },
    );
  }

  const raw = await response.text();
  if (!raw) {
    return new NextResponse(null, { status: response.status });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { message: raw };
  }

  return NextResponse.json(payload, { status: response.status });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  return proxy(request, path);
}
