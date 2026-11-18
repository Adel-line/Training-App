import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/env";

/**
 * Verifies the session with the Auth server (getUser, not the cookie contents)
 * and that it belongs to the allowed owner. Call from every protected page,
 * server action and route handler.
 */
export async function requireOwner() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || !isAllowedEmail(data.user.email)) {
    redirect("/login");
  }
  return { supabase, user: data.user };
}

/** Only same-site relative paths are accepted as post-login destinations. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/today";
  return next;
}
