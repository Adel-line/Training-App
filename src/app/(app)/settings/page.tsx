import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { StravaCard } from "./strava-card";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const sp = await searchParams;
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM _migrations").get() as { n: number };
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <p className="text-sm text-muted">Database</p>
        <p className="font-medium">Local SQLite · {row.n} migration(s) applied</p>
      </div>
      <StravaCard message={typeof sp.strava === "string" ? sp.strava : undefined} />
      <Link href="/settings/plan" className="tap flex items-center rounded-[var(--radius-card)] border border-line bg-surface p-4 font-semibold">
        Edit weekly plan ›
      </Link>
    </section>
  );
}
