import type { Metadata } from "next";

export const metadata: Metadata = { title: "Week" };

export default function WeekPage() {
  return (
    <section>
      <h1 className="text-2xl font-bold">Week</h1>
      <p className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-muted">
        Coming in a later milestone.
      </p>
    </section>
  );
}
