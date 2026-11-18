import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const initialError =
    error === "not_allowed"
      ? "This account isn't allowed to use the app."
      : error === "invalid_link"
        ? "That sign-in link is invalid or has expired. Request a new one."
        : undefined;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold">Training</h1>
        <p className="mt-1 text-muted">Private app. Sign in with the allowed email address.</p>
      </div>
      <LoginForm initialError={initialError} />
    </main>
  );
}
