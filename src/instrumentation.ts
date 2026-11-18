export async function register() {
  // Runs once when the server starts (Node only). Starts the Strava job worker and the public webhook listener.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.STRAVA_CLIENT_ID) {
    const { startScheduler } = await import("./lib/strava/scheduler");
    const { startWebhookListener } = await import("./lib/strava/listener");
    startScheduler();
    startWebhookListener();
  }
}
