import { NextRequest, NextResponse } from "next/server";

/**
 * HTTP Basic Auth for the entire app, configured via env vars.
 *
 *   ADMIN_USER  — username (any non-empty string)
 *   ADMIN_PASS  — password (long random string — use `openssl rand -hex 24`)
 *
 * Constant-time string comparison prevents byte-by-byte timing leaks. We only
 * support a single admin pair on purpose — promotes simple secret rotation
 * over multi-user state we don't actually need yet.
 */
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/health")) {
    return NextResponse.next();
  }

  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;

  if (!user || !pass) {
    return new NextResponse(
      "Admin auth not configured. Set ADMIN_USER and ADMIN_PASS env vars.",
      { status: 500 }
    );
  }

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = decodeBasic(header.slice(6));
    if (decoded && safeEqual(decoded.user, user) && safeEqual(decoded.pass, pass)) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="z0tz-dashboard", charset="UTF-8"' },
  });
}

function decodeBasic(b64: string): { user: string; pass: string } | null {
  try {
    const decoded = atob(b64);
    const idx = decoded.indexOf(":");
    if (idx === -1) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
