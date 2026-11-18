"use client";

export function RetryButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="tap rounded-xl bg-accent px-4 font-semibold text-accent-fg"
    >
      Try again
    </button>
  );
}
