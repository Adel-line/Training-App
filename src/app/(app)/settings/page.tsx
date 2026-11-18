import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { signOut } from "../actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user } = await requireOwner();
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <p className="text-sm text-muted">Signed in as</p>
        <p className="font-medium">{user.email}</p>
      </div>
      <form action={signOut}>
        <button type="submit" className="tap w-full rounded-xl border border-line bg-surface-2 px-4 font-semibold">
          Sign out
        </button>
      </form>
    </section>
  );
}
