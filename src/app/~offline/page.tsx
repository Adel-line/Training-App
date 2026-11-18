import type { Metadata } from "next";
import { RetryButton } from "./retry-button";
import { ResumeWorkouts } from "./resume-workouts";

export const metadata: Metadata = { title: "Offline" };

/** Generic, data-free shell shown when a page can't be fetched offline. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-2xl font-bold">You&apos;re offline</h1>
      <p className="text-muted">
        This page needs a connection. Anything you logged on this device is kept and will sync when
        you&apos;re back online.
      </p>
      <ResumeWorkouts />
      <RetryButton />
    </main>
  );
}
