"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { disconnectLocal } from "@/lib/strava/connection";
import { revokeAtStrava } from "@/lib/strava/oauth";
import { getTokenRow } from "@/lib/strava/tokens";

/** Explicit disconnect: revoke at Strava (documented /oauth/revoke), then drop tokens and cancel pending imports. Activities stay. */
export async function disconnectStrava() {
  const db = getDb();
  const row = getTokenRow(db);
  const revoked = row ? await revokeAtStrava(row.refresh_token) : true;
  disconnectLocal(db);
  revalidatePath("/settings");
  redirect(`/settings?strava=${revoked ? "disconnected" : "disconnected_unrevoked"}`);
}
