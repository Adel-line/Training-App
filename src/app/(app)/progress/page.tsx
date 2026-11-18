import type { Metadata } from "next";

export const metadata: Metadata = { title: "Progress" };

export default function ProgressPage() {
  return (
    <section>
      <h1 className="text-2xl font-bold">Progress</h1>
      <p className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-muted">
        Coming in a later milestone.
      </p>
    </section>
  );
}
