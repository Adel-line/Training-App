import type { Metadata } from "next";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM _migrations").get() as { n: number };
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <p className="text-sm text-muted">Database</p>
        <p className="font-medium">Local SQLite · {row.n} migration(s) applied</p>
      </div>
    </section>
  );
}
