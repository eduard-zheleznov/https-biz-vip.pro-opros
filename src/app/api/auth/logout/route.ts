import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { logoutCurrentUser } from "@/lib/data";

const LOGOUT_REDIRECT_PATH = "/login?loggedOut=1";

async function resolveRedirectUrl(request: Request) {
  const headerStore = await headers();
  const fallbackUrl = new URL(request.url);
  const protocol = headerStore.get("x-forwarded-proto") ?? fallbackUrl.protocol.replace(/:$/, "");
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? fallbackUrl.host;

  return new URL(LOGOUT_REDIRECT_PATH, `${protocol}://${host}`);
}

export async function GET(request: Request) {
  await logoutCurrentUser();
  return NextResponse.redirect(await resolveRedirectUrl(request));
}

export async function POST() {
  await logoutCurrentUser();
  return NextResponse.json({
    ok: true,
    redirectTo: LOGOUT_REDIRECT_PATH,
  });
}
