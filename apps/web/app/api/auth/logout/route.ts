import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const TOKEN_COOKIE = "medhaone_token";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(TOKEN_COOKIE);
  return NextResponse.json({ success: true });
}
