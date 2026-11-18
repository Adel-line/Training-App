import type { Metadata } from "next";
import { WorkoutScreen } from "./workout-screen";

export const metadata: Metadata = { title: "Workout" };

/**
 * Deliberately static and data-free: everything is read from the phone's local database,
 * so this page can be precached and opened offline.
 */
export default function WorkoutPage() {
  return <WorkoutScreen />;
}
