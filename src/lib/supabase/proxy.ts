import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env, isAllowedEmail } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/auth/", "/~offline", "/serwist/", "/manifest.webmanifest", "/icons/"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

/**
 * Refreshes the Supabase session cookie and redirects visitors who are not the
 * allowed owner. This is an optimistic gate; authorisation is re-checked with
 * getUser() in requireOwner() and by RLS.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const e = env();

  const supabase = createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const email = (data?.claims?.email as string | undefined) ?? null;
  const signedIn = Boolean(data?.claims);
  const allowed = signedIn && isAllowedEmail(email);
  const { pathname } = request.nextUrl;

  if (!allowed && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = signedIn ? "?error=not_allowed" : "";
    return NextResponse.redirect(url);
  }
  if (allowed && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/today";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}
