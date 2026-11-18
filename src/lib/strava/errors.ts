export class NotConnectedError extends Error {
  constructor() {
    super("Strava is not connected");
  }
}
/** Strava rejected our credentials (revoked or invalid). Retrying won't help; the user must reconnect. */
export class StravaAuthError extends Error {}
/** 429: retry no earlier than `until`. */
export class RateLimitedError extends Error {
  until: Date;
  constructor(until: Date) {
    super(`Rate limited until ${until.toISOString()}`);
    this.until = until;
  }
}
/** Network or 5xx problem: worth retrying with backoff. */
export class TransientError extends Error {}
