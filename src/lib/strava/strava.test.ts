import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../db";
import { makeApi } from "./client";
import { disconnectLocal, saveConnection } from "./connection";
import { claimNext, complete, defer, enqueue, getMeta, nextDueAt, recoverStale, setMeta } from "./jobs";
import { toActivityRow } from "./mapping";
import { consumeState, createState, hasActivityAccess, parseScopes } from "./oauth";
import { nextQuarterHour, nextUtcMidnight, parseRate, retryAfter429, shouldPause } from "./rate";
import { getAccessToken, getTokenRow } from "./tokens";
import { handleEvent, handleVerification, SUBSCRIPTION_META } from "./webhook";
import { drain, processOne, rateLimitedUntil, type Ctx } from "./worker";

process.env.STRAVA_CLIENT_ID = "123";
process.env.STRAVA_CLIENT_SECRET = "secret";

let db: DatabaseSync;
let nowMs: number;
const NOW0 = Date.parse("2026-11-25T10:07:00Z");

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  nowMs = NOW0;
});

const connect = (over: Partial<{ expiresAt: number; athleteId: number }> = {}) =>
  saveConnection(db, { athleteId: over.athleteId ?? 42, accessToken: "AT1", refreshToken: "RT1", expiresAt: over.expiresAt ?? Math.floor(nowMs / 1000) + 6 * 3600, scope: "read,activity:read_all" }, new Date(nowMs));

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;
const fakeFetch = (h: Handler) => vi.fn(async (u: unknown, init?: RequestInit) => h(u instanceof URL ? u : new URL(String(u)), init)) as unknown as typeof fetch;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers });
const ctxFor = (h: Handler): Ctx => ({ db, api: makeApi(db, fakeFetch(h), () => nowMs), now: () => new Date(nowMs) });
const act = (id: number, type = "Run", extra: Record<string, unknown> = {}) => ({
  id, name: `a${id}`, sport_type: type, type, start_date: "2026-11-24T06:30:00Z", distance: 5200, moving_time: 1900,
  total_elevation_gain: 30, average_heartrate: 150, average_speed: 2.7, ...extra,
});
const rows = () => db.prepare("SELECT strava_activity_id AS id, activity_type AS t FROM strava_activities ORDER BY id").all() as { id: number; t: string }[];
const jobs = () => db.prepare("SELECT kind, status, attempts, run_after, last_error, payload FROM strava_jobs ORDER BY created_at, rowid").all() as { kind: string; status: string; attempts: number; run_after: string; last_error: string | null; payload: string }[];
const evt = (over: Record<string, unknown> = {}) => ({ object_type: "activity", object_id: 900, aspect_type: "create", owner_id: 42, subscription_id: 7, event_time: 1000, ...over });

describe("activity mapping", () => {
  it("keeps Run, TrailRun, Hike and Snowboard, using sport_type before the deprecated type", () => {
    for (const t of ["Run", "TrailRun", "Hike", "Snowboard"]) expect(toActivityRow(act(1, t))?.activity_type).toBe(t);
    expect(toActivityRow({ ...act(1, "TrailRun"), type: "Run" })?.activity_type).toBe("TrailRun");
    expect(toActivityRow({ id: 2, start_date: "2026-11-24T06:30:00Z", type: "Hike" })?.activity_type).toBe("Hike");
  });
  it("skips other types and unusable payloads", () => {
    for (const t of ["Ride", "BackcountrySki", "WeightTraining", "Walk", "VirtualRun"]) expect(toActivityRow(act(1, t))).toBeNull();
    expect(toActivityRow({ id: "x" })).toBeNull();
    expect(toActivityRow(null)).toBeNull();
  });
  it("maps fields and tolerates missing optional ones", () => {
    expect(toActivityRow(act(5))).toMatchObject({ strava_activity_id: 5, distance_m: 5200, moving_time_s: 1900, elevation_gain_m: 30, avg_hr: 150, avg_speed_mps: 2.7 });
    expect(toActivityRow({ id: 6, sport_type: "Run", start_date: "2026-11-24T06:30:00Z" })).toMatchObject({ avg_hr: null, elevation_gain_m: null, distance_m: 0 });
  });
});

describe("rate limits", () => {
  it("parses read limits (preferred) and overall limits", () => {
    expect(parseRate(new Headers({ "X-ReadRateLimit-Limit": "100,1000", "X-ReadRateLimit-Usage": "12,40", "X-RateLimit-Limit": "200,2000", "X-RateLimit-Usage": "99,99" }))).toEqual({ limit15: 100, limitDay: 1000, use15: 12, useDay: 40 });
    expect(parseRate(new Headers({ "X-RateLimit-Limit": "200,2000", "X-RateLimit-Usage": "3,4" }))?.limit15).toBe(200);
    expect(parseRate(new Headers())).toBeNull();
  });
  it("windows: next :00/:15/:30/:45 and midnight UTC", () => {
    expect(nextQuarterHour(new Date("2026-11-25T10:07:30Z")).toISOString()).toBe("2026-11-25T10:15:00.000Z");
    expect(nextQuarterHour(new Date("2026-11-25T10:45:00Z")).toISOString()).toBe("2026-11-25T11:00:00.000Z");
    expect(nextUtcMidnight(new Date("2026-12-31T23:59:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
  it("a 429 waits for the 15-minute reset, or for midnight UTC when the daily limit is spent", () => {
    const now = new Date("2026-11-25T10:07:00Z");
    const short = new Headers({ "X-ReadRateLimit-Limit": "100,1000", "X-ReadRateLimit-Usage": "101,300" });
    const daily = new Headers({ "X-ReadRateLimit-Limit": "100,1000", "X-ReadRateLimit-Usage": "50,1001" });
    expect(retryAfter429(short, now).getTime()).toBeGreaterThan(Date.parse("2026-11-25T10:15:00Z"));
    expect(retryAfter429(short, now).getTime()).toBeLessThan(Date.parse("2026-11-25T10:16:00Z"));
    expect(retryAfter429(daily, now).getTime()).toBeGreaterThan(Date.parse("2026-11-26T00:00:00Z"));
    expect(retryAfter429(new Headers(), now).getTime()).toBeGreaterThan(Date.parse("2026-11-25T10:15:00Z"));
  });
  it("pauses proactively when nearly out of requests", () => {
    expect(shouldPause({ limit15: 100, limitDay: 1000, use15: 99, useDay: 10 })).toBe(true);
    expect(shouldPause({ limit15: 100, limitDay: 1000, use15: 20, useDay: 10 })).toBe(false);
    expect(shouldPause(null)).toBe(false);
  });
});

describe("token refresh", () => {
  const refreshHandler = (calls: { n: number }): Handler => async (url, init) => {
    expect(url.pathname).toBe("/api/v3/oauth/token");
    const body = new URLSearchParams(String(init!.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    calls.n++;
    await new Promise((r) => setTimeout(r, 20));
    return json({ access_token: `AT${calls.n + 1}`, refresh_token: `RT${calls.n + 1}`, expires_at: Math.floor(nowMs / 1000) + 21600 });
  };
  it("does not refresh a token with more than five minutes left", async () => {
    connect();
    const calls = { n: 0 };
    expect(await getAccessToken(db, fakeFetch(refreshHandler(calls)), () => nowMs)).toBe("AT1");
    expect(calls.n).toBe(0);
  });
  it("refreshes within five minutes of expiry and saves both tokens", async () => {
    connect({ expiresAt: Math.floor(nowMs / 1000) + 200 });
    const calls = { n: 0 };
    expect(await getAccessToken(db, fakeFetch(refreshHandler(calls)), () => nowMs)).toBe("AT2");
    expect(getTokenRow(db)).toMatchObject({ access_token: "AT2", refresh_token: "RT2", refresh_lease_until: 0 });
  });
  it("concurrent callers trigger a single refresh and all get the new token", async () => {
    connect({ expiresAt: Math.floor(nowMs / 1000) + 10 });
    const calls = { n: 0 };
    const f = fakeFetch(refreshHandler(calls));
    const tokens = await Promise.all([1, 2, 3, 4].map(() => getAccessToken(db, f, () => nowMs)));
    expect(calls.n).toBe(1);
    expect(new Set(tokens)).toEqual(new Set(["AT2"]));
    expect(getTokenRow(db)!.refresh_token).toBe("RT2");
  });
  it("releases the lease on failure so a later attempt can succeed", async () => {
    connect({ expiresAt: Math.floor(nowMs / 1000) + 10 });
    await expect(getAccessToken(db, fakeFetch(() => json({}, 503)), () => nowMs)).rejects.toThrow(/refresh failed/);
    expect(getTokenRow(db)!.refresh_lease_until).toBe(0);
    expect(getTokenRow(db)!.refresh_token).toBe("RT1");
    expect(await getAccessToken(db, fakeFetch(refreshHandler({ n: 0 })), () => nowMs)).toBe("AT2");
  });
  it("a refused refresh token raises an auth error", async () => {
    connect({ expiresAt: Math.floor(nowMs / 1000) + 10 });
    await expect(getAccessToken(db, fakeFetch(() => json({ message: "Bad Request" }, 400)), () => nowMs)).rejects.toThrow(/Reconnect/);
  });
});

describe("job queue", () => {
  it("dedupes, claims oldest due first, and doesn't count rate-limit deferrals as attempts", () => {
    expect(enqueue(db, { kind: "webhook_event", dedupeKey: "a", payload: {} })).toBe(true);
    expect(enqueue(db, { kind: "webhook_event", dedupeKey: "a", payload: {} })).toBe(false);
    enqueue(db, { kind: "webhook_event", dedupeKey: "later", payload: {}, runAfter: new Date(Date.now() + 3600_000) });
    const j = claimNext(db)!;
    expect(j.dedupe_key).toBe("a");
    expect(j.attempts).toBe(1);
    expect(claimNext(db)).toBeNull(); // the other isn't due yet
    defer(db, j.id, new Date(Date.now() + 1000), "rate limited", false);
    expect(jobs()[0]).toMatchObject({ status: "pending", attempts: 0 });
    expect(nextDueAt(db)).toBeTruthy();
  });
  it("jobs interrupted mid-run are recovered", () => {
    enqueue(db, { kind: "webhook_event", dedupeKey: "a", payload: {} });
    claimNext(db);
    expect(recoverStale(db, 60_000)).toBe(0);
    expect(recoverStale(db, 60_000, new Date(Date.now() + 120_000))).toBe(1);
    expect(jobs()[0].status).toBe("pending");
    complete(db, "x"); // no-op for unknown ids
  });
});

describe("OAuth state", () => {
  it("is single-use, tied to the browser cookie, and expires", () => {
    const now = new Date("2026-11-25T10:00:00Z");
    const s = createState(db, now);
    expect(consumeState(db, s, "other", now)).toBe(false); // wrong browser
    expect(consumeState(db, s, s, now)).toBe(true);
    expect(consumeState(db, s, s, now)).toBe(false); // replay
    const s2 = createState(db, now);
    expect(consumeState(db, s2, s2, new Date(now.getTime() + 11 * 60_000))).toBe(false); // expired
    expect(consumeState(db, null, s, now)).toBe(false);
    expect(consumeState(db, "never-issued", "never-issued", now)).toBe(false);
  });
  it("reads granted scopes in either format", () => {
    expect(parseScopes("read,activity:read_all")).toEqual(["read", "activity:read_all"]);
    expect(parseScopes("read activity:read")).toEqual(["read", "activity:read"]);
    expect(hasActivityAccess(parseScopes("read"))).toBe(false);
    expect(hasActivityAccess(parseScopes("read,activity:read"))).toBe(true);
  });
});

describe("connection", () => {
  it("queues exactly one backfill per connection", () => {
    connect();
    expect(jobs().filter((j) => j.kind === "backfill")).toHaveLength(1);
    nowMs += 1000;
    connect(); // reconnecting is a new connection: old work cancelled, new backfill queued
    expect(jobs().filter((j) => j.status === "pending" && j.kind === "backfill")).toHaveLength(1);
    expect(jobs().filter((j) => j.status === "cancelled")).toHaveLength(1);
    expect(JSON.parse(jobs().at(-1)!.payload).after).toBe(Math.floor(nowMs / 1000) - 90 * 86400);
  });
  it("disconnect removes tokens, cancels work, keeps imported history", async () => {
    connect();
    db.exec("INSERT INTO strava_activities (strava_activity_id, start_date, activity_type) VALUES (1, '2026-11-24T06:00:00Z', 'Run')");
    expect(disconnectLocal(db)).toMatchObject({ athleteId: 42, cancelled: 1 });
    expect(getTokenRow(db)).toBeUndefined();
    expect(jobs().every((j) => j.status === "cancelled")).toBe(true);
    expect(rows()).toHaveLength(1);
    // later events for that athlete are ignored, not queued
    expect(handleEvent(db, evt())).toMatchObject({ status: 200, text: "ignored" });
    expect(jobs().filter((j) => j.kind === "webhook_event")).toHaveLength(0);
  });
});

describe("webhook", () => {
  it("answers Strava's validation request with the challenge as JSON", () => {
    const q = (o: Record<string, string>) => new URLSearchParams(o);
    expect(handleVerification(q({ "hub.mode": "subscribe", "hub.challenge": "abc", "hub.verify_token": "TOKEN" }), "TOKEN")).toEqual({ status: 200, json: { "hub.challenge": "abc" } });
    expect(handleVerification(q({ "hub.mode": "subscribe", "hub.challenge": "abc", "hub.verify_token": "nope" }), "TOKEN").status).toBe(403);
    expect(handleVerification(q({ "hub.mode": "unsubscribe", "hub.challenge": "abc", "hub.verify_token": "TOKEN" }), "TOKEN").status).toBe(403);
    expect(handleVerification(q({ "hub.mode": "subscribe", "hub.verify_token": "TOKEN" }), "TOKEN").status).toBe(403);
    expect(handleVerification(q({ "hub.mode": "subscribe", "hub.challenge": "abc", "hub.verify_token": "" }), "").status).toBe(403); // no token configured
  });
  it("queues valid events for the connected athlete, once even if delivered repeatedly", () => {
    connect();
    setMeta(db, SUBSCRIPTION_META, "7");
    expect(handleEvent(db, evt())).toMatchObject({ status: 200, enqueued: true });
    expect(handleEvent(db, evt())).toMatchObject({ status: 200, enqueued: false });
    expect(jobs().filter((j) => j.kind === "webhook_event")).toHaveLength(1);
  });
  it("rejects malformed payloads and other subscriptions; ignores other athletes", () => {
    connect();
    setMeta(db, SUBSCRIPTION_META, "7");
    expect(handleEvent(db, { nope: 1 }).status).toBe(400);
    expect(handleEvent(db, null).status).toBe(400);
    expect(handleEvent(db, evt({ subscription_id: 8 })).status).toBe(403);
    expect(handleEvent(db, evt({ owner_id: 999 }))).toMatchObject({ status: 200, text: "ignored" });
    expect(jobs().filter((j) => j.kind === "webhook_event")).toHaveLength(0);
  });
  it("athlete deauthorization disconnects immediately", () => {
    connect();
    expect(handleEvent(db, evt({ object_type: "athlete", object_id: 42, aspect_type: "update", updates: { authorized: "false" } })).status).toBe(200);
    expect(getTokenRow(db)).toBeUndefined();
  });
});

describe("backfill", () => {
  const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => act(from + i, i % 10 === 0 ? "Ride" : "Run"));
  it("imports 90 days across pages, skipping unsupported types, and is not duplicated on rerun", async () => {
    connect();
    const seen: string[] = [];
    const ctx = ctxFor((url) => {
      seen.push(`${url.pathname}?page=${url.searchParams.get("page")}&after=${url.searchParams.get("after")}`);
      const p = Number(url.searchParams.get("page"));
      return json(p === 1 ? page(1, 50) : p === 2 ? page(51, 7) : []);
    });
    await drain(ctx);
    expect(seen).toEqual([`/api/v3/athlete/activities?page=1&after=${Math.floor(nowMs / 1000) - 90 * 86400}`, `/api/v3/athlete/activities?page=2&after=${Math.floor(nowMs / 1000) - 90 * 86400}`]);
    expect(rows()).toHaveLength(57 - 6); // every tenth is a Ride (ids 1, 11, ... 51)
    expect(rows().every((r) => r.t === "Run")).toBe(true);
    expect(jobs()[0]).toMatchObject({ kind: "backfill", status: "done" });
    await drain(ctx); // nothing left to do
    expect(rows()).toHaveLength(51);
  });
  it("resumes where it stopped after a 429, without re-importing", async () => {
    connect();
    let calls = 0;
    const ctx = ctxFor((url) => {
      calls++;
      const p = Number(url.searchParams.get("page"));
      if (p === 2 && calls < 3) return json({ message: "Rate Limit Exceeded" }, 429, { "X-ReadRateLimit-Limit": "100,1000", "X-ReadRateLimit-Usage": "101,200" });
      return json(p === 1 ? page(1, 50) : page(51, 3));
    });
    const wake = await drain(ctx);
    expect(rows()).toHaveLength(45); // page 1 only (every 10th of 50 is a Ride)
    expect(jobs()[0]).toMatchObject({ status: "pending", attempts: 0 }); // a rate limit is not a failure
    expect(JSON.parse(jobs()[0].payload).page).toBe(2); // progress persisted
    expect(wake!.getTime()).toBeGreaterThan(Date.parse("2026-11-25T10:15:00Z")); // retry after the 15-minute reset
    expect(rateLimitedUntil(db)).toBeTruthy(); // persisted, applies to all jobs
    // still inside the window: nothing happens
    expect((await processOne(ctx)).state).toBe("paused");
    nowMs = wake!.getTime() + 1000;
    await drain(ctx);
    expect(jobs()[0].status).toBe("done");
    expect(rows().length).toBe(45 + 3 - 1); // page 2 adds 51..53 minus the Ride (51)
    expect(new Set(rows().map((r) => r.id)).size).toBe(rows().length);
  });
  it("pauses on its own when the headers show the window nearly used up", async () => {
    connect();
    const ctx = ctxFor((url) => json(Number(url.searchParams.get("page")) === 1 ? page(1, 50) : [], 200, { "X-ReadRateLimit-Limit": "100,1000", "X-ReadRateLimit-Usage": "99,500" }));
    const wake = await drain(ctx);
    expect(jobs()[0].status).toBe("pending");
    expect(wake!.getTime()).toBeGreaterThan(Date.parse("2026-11-25T10:15:00Z"));
  });
  it("never resurrects an activity that was deleted", async () => {
    connect();
    db.prepare("INSERT INTO strava_deleted (strava_activity_id, event_time) VALUES (2, 5000)").run();
    await drain(ctxFor(() => json([act(2), act(3)])));
    expect(rows().map((r) => r.id)).toEqual([3]);
  });
  it("a job cancelled mid-flight writes nothing", async () => {
    connect();
    const ctx = ctxFor(() => {
      disconnectLocal(db); // user disconnects while the request is out
      return json([act(1), act(2)]);
    });
    await drain(ctx);
    expect(rows()).toHaveLength(0);
  });
});

describe("webhook events through the worker", () => {
  const deliver = (e: Record<string, unknown>) => expect(handleEvent(db, evt(e), new Date(nowMs)).status).toBe(200);
  const stravaWith = (state: { current: unknown; status?: number }) => ctxFor((url) => (url.pathname.startsWith("/api/v3/activities/") ? (state.status === 404 ? json({}, 404) : json(state.current)) : json([])));

  it("create then update (title, then type to unsupported) then delete", async () => {
    connect();
    await drain(ctxFor(() => json([]))); // finish backfill
    const state = { current: act(900, "Run") as unknown, status: 200 };
    const ctx = stravaWith(state);

    deliver({ aspect_type: "create", event_time: 1000 });
    await drain(ctx);
    expect(rows()).toEqual([{ id: 900, t: "Run" }]);

    state.current = act(900, "Run", { name: "Renamed" });
    deliver({ aspect_type: "update", event_time: 1100, updates: { title: "Renamed" } });
    await drain(ctx);
    expect((db.prepare("SELECT name FROM strava_activities").get() as { name: string }).name).toBe("Renamed");

    state.current = act(900, "Ride");
    deliver({ aspect_type: "update", event_time: 1200, updates: { type: "Ride" } });
    await drain(ctx);
    expect(rows()).toHaveLength(0); // no longer a supported type: removed from the local list

    state.current = act(900, "Hike");
    deliver({ aspect_type: "update", event_time: 1300, updates: { type: "Hike" } });
    await drain(ctx);
    expect(rows()).toEqual([{ id: 900, t: "Hike" }]);

    deliver({ aspect_type: "delete", event_time: 1400 });
    await drain(ctx);
    expect(rows()).toHaveLength(0);
  });
  it("a stale create/update arriving after a delete cannot recreate the activity", async () => {
    connect();
    await drain(ctxFor(() => json([])));
    const state = { current: act(900, "Run") as unknown };
    const ctx = stravaWith(state);
    deliver({ aspect_type: "delete", event_time: 2000 });
    await drain(ctx);
    deliver({ aspect_type: "create", event_time: 1500 }); // older than the delete
    deliver({ aspect_type: "update", event_time: 1999, updates: { title: "x" } });
    const before = jobs().length;
    await drain(ctx);
    expect(rows()).toHaveLength(0);
    expect(jobs().length).toBe(before);
    // newer genuine create (e.g. visibility restored) works again
    deliver({ aspect_type: "create", event_time: 3000 });
    await drain(ctx);
    expect(rows()).toHaveLength(1);
  });
  it("an event for an activity Strava no longer returns removes it and doesn't recreate it", async () => {
    connect();
    await drain(ctxFor(() => json([])));
    upsertDirect();
    const ctx = stravaWith({ current: null, status: 404 });
    deliver({ aspect_type: "update", event_time: 1100, updates: { title: "x" } });
    await drain(ctx);
    expect(rows()).toHaveLength(0);
    function upsertDirect() {
      db.exec("INSERT INTO strava_activities (strava_activity_id, start_date, activity_type) VALUES (900, '2026-11-24T06:00:00Z', 'Run')");
    }
  });
  it("an auth failure stops the job without retries; transient errors back off then give up", async () => {
    connect();
    await drain(ctxFor(() => json([])));
    deliver({ aspect_type: "create", event_time: 1000 });
    await drain(ctxFor(() => json({}, 401)));
    expect(jobs().at(-1)).toMatchObject({ status: "failed" });
    expect(jobs().at(-1)!.last_error).toMatch(/Reconnect/);

    deliver({ object_id: 901, aspect_type: "create", event_time: 1001 });
    const down = ctxFor(() => json({}, 503));
    for (let i = 1; i <= 8; i++) {
      await processOne(down);
      const j = jobs().at(-1)!;
      if (i < 8) {
        expect(j).toMatchObject({ status: "pending", attempts: i });
        expect(Date.parse(j.run_after)).toBeGreaterThan(nowMs); // backoff scheduled
        nowMs = Date.parse(j.run_after) + 1;
      } else expect(j.status).toBe("failed");
    }
  });
  it("a rate-limited event is retried later and then imported", async () => {
    connect();
    await drain(ctxFor(() => json([])));
    deliver({ aspect_type: "create", event_time: 1000 });
    let limited = true;
    const ctx = ctxFor(() => (limited ? json({}, 429) : json(act(900))));
    const wake = await drain(ctx);
    expect(rows()).toHaveLength(0);
    limited = false;
    nowMs = wake!.getTime() + 1;
    await drain(ctx);
    expect(rows()).toHaveLength(1);
    expect(getMeta(db, "strava_rate_limited_until")).toBeNull();
  });
});
