"use client";

import { useActionState } from "react";
import { requestMagicLink, type LoginState } from "./actions";

const initial: LoginState = { status: "idle" };

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, action, pending] = useActionState(requestMagicLink, initial);
  const message = state.message ?? initialError;
  const isError = state.status === "error" || (state.status === "idle" && Boolean(initialError));

  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="email" className="text-sm text-muted">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        required
        className="tap rounded-xl border border-line bg-surface px-4 text-base"
      />
      <button
        type="submit"
        disabled={pending}
        className="tap rounded-xl bg-accent px-4 font-semibold text-accent-fg disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
      {message && (
        <p role="status" className={isError ? "text-danger" : "text-ok"}>
          {message}
        </p>
      )}
    </form>
  );
}
