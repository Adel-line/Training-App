"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/env";

export type LoginState = { status: "idle" | "sent" | "error"; message?: string };

const emailSchema = z.object({ email: z.email().max(254) });

export async function requestMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = emailSchema.safeParse({ email: String(formData.get("email") ?? "").trim() });
  if (!parsed.success) return { status: "error", message: "Enter a valid email address." };

  // Allowlist is enforced here, before Supabase is ever asked to send a link.
  if (!isAllowedEmail(parsed.data.email)) {
    return { status: "error", message: "This app is private. That address isn't allowed." };
  }

  const supabase = await createClient();
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: appUrl ? { emailRedirectTo: `${appUrl}/auth/confirm` } : undefined,
  });
  if (error) {
    // Don't log the address; the status code is enough to debug rate limits.
    console.error("magic link request failed", error.status ?? "", error.code ?? "");
    return { status: "error", message: "Couldn't send the link. Wait a minute and try again." };
  }
  return { status: "sent", message: "Check your email for the sign-in link." };
}
