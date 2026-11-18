import type { Metadata } from "next";
import { formatLongDate, localDate } from "@/lib/dates";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage() {
  return (
    <section>
      <h1 className="text-2xl font-bold">Today</h1>
      <p className="mt-1 text-muted">{formatLongDate(localDate())}</p>
      <p className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-muted">
        Your plan appears here once the schema and seed are in (milestone 2).
      </p>
    </section>
  );
}
