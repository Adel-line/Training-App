import { Card, primaryBtn, secondaryBtn } from "@/components/ui";
import { getDb } from "@/lib/db";
import { getStravaStatus } from "@/lib/strava/status";
import { disconnectStrava } from "./strava-actions";

const MESSAGES: Record<string, { tone: "ok" | "err"; text: string }> = {
  connected: { tone: "ok", text: "Strava connected. Importing the last 90 days now." },
  disconnected: { tone: "ok", text: "Disconnected and access revoked at Strava. Imported activities were kept." },
  disconnected_unrevoked: { tone: "err", text: "Disconnected here, but Strava couldn't be reached to revoke access. Remove the app at strava.com/settings/apps. Imported activities were kept." },
  denied: { tone: "err", text: "Strava access was not granted." },
  scope: { tone: "err", text: "Strava needs permission to read your activities. Connect again and leave the activity box ticked." },
  bad_state: { tone: "err", text: "That sign-in link expired or came from another browser. Start the connection again." },
  error: { tone: "err", text: "Couldn't complete the connection. Try again." },
  not_configured: { tone: "err", text: "Strava isn't set up yet: add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET (see the README)." },
};

const fmt = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export function StravaCard({ message }: { message?: string }) {
  const s = getStravaStatus(getDb());
  const m = message ? MESSAGES[message] : undefined;
  const bf = s.backfill;
  const backfillText = !bf
    ? "Not started"
    : bf.status === "done"
      ? `Done · ${bf.imported} runs/hikes/snowboard days imported`
      : bf.status === "failed"
        ? `Failed: ${bf.error ?? "unknown error"}`
        : bf.status === "cancelled"
          ? "Cancelled"
          : s.rateLimitedUntil
            ? `Paused for Strava's rate limit until ${fmt(s.rateLimitedUntil)} (page ${bf.page})`
            : `Importing… ${bf.imported} so far (page ${bf.page})`;

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Strava</h2>
      {m && (
        <p role="status" className={m.tone === "ok" ? "text-ok" : "text-danger"}>
          {m.text}
        </p>
      )}
      {s.connected ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Athlete</dt>
            <dd>{s.athleteId}</dd>
            <dt className="text-muted">Access</dt>
            <dd>{s.scope}</dd>
            <dt className="text-muted">Backfill</dt>
            <dd data-testid="backfill-status">{backfillText}</dd>
            <dt className="text-muted">Live updates</dt>
            <dd>{s.subscriptionId ? `On (subscription ${s.subscriptionId})` : "Not set up yet, see the README"}</dd>
            <dt className="text-muted">Activities</dt>
            <dd>
              {s.activityCount}
              {s.lastActivity ? ` · latest ${fmt(s.lastActivity)}` : ""}
            </dd>
            {s.pendingEvents > 0 && (
              <>
                <dt className="text-muted">Queued</dt>
                <dd>{s.pendingEvents} update(s) being imported</dd>
              </>
            )}
            {s.failedJobs > 0 && (
              <>
                <dt className="text-muted">Problems</dt>
                <dd className="text-danger">{s.failedJobs} import(s) failed. Reconnecting Strava usually fixes it.</dd>
              </>
            )}
          </dl>
          <form action={disconnectStrava}>
            <button type="submit" className={`${secondaryBtn} w-full`}>
              Disconnect Strava
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="text-muted">Connect to import your runs, hikes and snowboard days from Strava (your Garmin already syncs there).</p>
          {/* A plain link on purpose: this must be a full page navigation to leave for Strava. */}
          <a href="/api/strava/connect" className={primaryBtn}>
            Connect Strava
          </a>
        </>
      )}
    </Card>
  );
}
