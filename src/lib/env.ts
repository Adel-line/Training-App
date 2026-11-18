import { z } from "zod";

/**
 * NEXT_PUBLIC_* values must be referenced literally so Next.js can inline them
 * into the browser bundle. Everything else is server-only and must never be
 * imported from a Client Component.
 */
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  ALLOWED_EMAIL: z.email(),
});

let cached: z.infer<typeof schema> | undefined;

export function env() {
  if (!cached) {
    const parsed = schema.safeParse({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ALLOWED_EMAIL: process.env.ALLOWED_EMAIL,
    });
    if (!parsed.success) {
      // Names only, never values.
      const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid or missing environment variables: ${names}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === env().ALLOWED_EMAIL.trim().toLowerCase();
}
