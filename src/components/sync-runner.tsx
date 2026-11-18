"use client";

import { useEffect } from "react";
import { startSyncTriggers } from "@/lib/offline/sync";

/** Flushes queued edits when the app opens, returns to the foreground, or goes back online. */
export function SyncRunner() {
  useEffect(() => startSyncTriggers(), []);
  return null;
}
