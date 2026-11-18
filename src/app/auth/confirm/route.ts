import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/env";
import { safeNext } from "@/lib/auth";

const params = z.object({
  token_hash: z.string().min(1),
  type: z.enum(["email", "magiclink"]),
});

/**
 * Magic-link landing. Uses the token-hash flow so the link works even when it
 * opens in a different browser than the one that requested it (e.g. Safari
 * instead of the installed home-screen app). Requires the email template in the
 * README.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const fail = (error: string) => {
    const to = url.clone();
    to.pathname = "/login";
    to.search = `?error=${error}`;
    return NextResponse.redirect(to);
  };

  const parsed = params.safeParse({
    token_hash: url.searchParams.get("token_hash"),
    type: url.searchParams.get("type"),
  });
  if (!parsed.success) return fail("invalid_link");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    type: parsed.data.type,
    token_hash: parsed.data.token_hash,
  });
  if (error || !data.user) return fail("invalid_link");

  // Allowlist check when the session is established.
  if (!isAllowedEmail(data.user.email)) {
    await supabase.auth.signOut();
    return fail("not_allowed");
  }

  const to = url.clone();
  to.pathname = safeNext(url.searchParams.get("next"));
  to.search = "";
  return NextResponse.redirect(to);
}
