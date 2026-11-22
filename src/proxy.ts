import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfig } from "@/lib/auth-config";

export async function proxy(request: NextRequest) {
  const config = getAuthConfig();
  const protectedPath = request.nextUrl.pathname.startsWith("/trips");
  let response = NextResponse.next({ request });
  let verified = false;

  if (config) {
    const client = createServerClient(config.supabaseUrl, config.publishableKey, {
      cookieOptions: { httpOnly: true, secure: config.secure },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(items, headers) {
          for (const { name, value } of items) request.cookies.set(name, value);
          const updated = NextResponse.next({ request });
          for (const cookie of response.cookies.getAll()) updated.cookies.set(cookie);
          for (const { name, value, options } of items) updated.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(headers)) updated.headers.set(key, value);
          response = updated;
        },
      },
    });

    try {
      const { data, error } = await client.auth.getClaims();
      verified = !error && Boolean(data?.claims?.sub);
    } catch {
      // Protected pages verify identity independently and deny access on failure.
    }
  }

  if (protectedPath && !verified) {
    const redirect = NextResponse.redirect(new URL("/login", config?.appUrl ?? request.url), {
      status: 307,
      headers: { "Cache-Control": "private, no-store" },
    });
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = { matcher: ["/login", "/trips/:path*"] };
