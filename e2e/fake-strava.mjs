// A small stand-in for Strava used only by the e2e tests (the app's STRAVA_BASE_URL points here).
// It follows the documented behaviour: OAuth redirect with code/state/scope, rotating refresh tokens
// (a stale refresh token is refused), paginated /athlete/activities, /activities/{id}, 429s on demand,
// and /oauth/revoke with HTTP Basic auth.
import http from "node:http";

const PORT = Number(process.env.FAKE_STRAVA_PORT || 3400);
const state = {
  n: 0, access: null, refresh: null, refreshCount: 0, revokeCount: 0, revokedWith: null,
  activities: new Map(), subscription: null, activityRequests: 0, listRequests: [], authorize: null, rateLimitNext: 0, badBearer: 0, exchangeCodes: [],
};
const now = () => Math.floor(Date.now() / 1000);
function issue(expiresIn) {
  state.n++;
  state.access = `access-${state.n}`;
  state.refresh = `refresh-${state.n}`;
  return { token_type: "Bearer", access_token: state.access, refresh_token: state.refresh, expires_at: now() + expiresIn, expires_in: expiresIn };
}
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", "X-ReadRateLimit-Limit": "100,1000", "X-ReadRateLimit-Usage": "3,30", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const readBody = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;

  if (p === "/oauth/authorize") {
    state.authorize = Object.fromEntries(url.searchParams);
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("state", url.searchParams.get("state"));
    back.searchParams.set("code", "GOODCODE");
    back.searchParams.set("scope", "read,activity:read_all");
    res.writeHead(302, { Location: back.toString() }).end();
    return;
  }
  if (p === "/api/v3/oauth/token" && req.method === "POST") {
    const f = new URLSearchParams(await readBody(req));
    if (f.get("client_id") !== "123" || f.get("client_secret") !== "secret") return send(res, 401, { message: "Authorization Error" });
    if (f.get("grant_type") === "authorization_code") {
      state.exchangeCodes.push(f.get("code"));
      if (f.get("code") !== "GOODCODE") return send(res, 400, { message: "Bad Request" });
      // Short-lived on purpose: the app must refresh before its first API call.
      return send(res, 200, { ...issue(120), athlete: { id: 4242 }, scope: "read,activity:read_all" });
    }
    if (f.get("grant_type") === "refresh_token") {
      if (f.get("refresh_token") !== state.refresh) return send(res, 400, { message: "Bad Request" }); // rotated: old one is dead
      state.refreshCount++;
      return send(res, 200, issue(21600));
    }
    return send(res, 400, {});
  }
  if (p === "/oauth/revoke" && req.method === "POST") {
    const basic = Buffer.from((req.headers.authorization ?? "").replace("Basic ", ""), "base64").toString();
    if (basic !== "123:secret") return send(res, 401, {});
    state.revokeCount++;
    state.revokedWith = new URLSearchParams(await readBody(req)).get("token");
    return send(res, 200);
  }
  if (p === "/__set" && req.method === "POST") {
    const b = JSON.parse(await readBody(req));
    for (const a of b.activities ?? []) state.activities.set(a.id, a);
    for (const id of b.remove ?? []) state.activities.delete(id);
    if (b.rateLimitNext) state.rateLimitNext = b.rateLimitNext;
    return send(res, 200, {});
  }
  if (p === "/__state") {
    return send(res, 200, { ...state, activities: [...state.activities.keys()] });
  }

  if (p.startsWith("/api/v3/push_subscriptions")) {
    const form = req.method === "POST" ? new URLSearchParams(await readBody(req)) : url.searchParams;
    if (form.get("client_id") !== "123" || form.get("client_secret") !== "secret") return send(res, 401, { message: "Authorization Error" });
    if (req.method === "GET") return send(res, 200, state.subscription ? [state.subscription] : []);
    if (req.method === "DELETE") { state.subscription = null; res.writeHead(204).end(); return; }
    if (req.method === "POST") {
      if (state.subscription) return send(res, 400, { message: "Bad Request", errors: [{ resource: "PushSubscription", code: "already exists" }] });
      // Strava validates the callback before accepting the subscription, and echoes the token we gave it.
      const challenge = `ch-${Math.random().toString(16).slice(2)}`;
      const cb = new URL(form.get("callback_url"));
      cb.searchParams.set("hub.mode", "subscribe");
      cb.searchParams.set("hub.challenge", challenge);
      cb.searchParams.set("hub.verify_token", form.get("verify_token"));
      let ok = false;
      try {
        const r = await fetch(cb, { signal: AbortSignal.timeout(2000) });
        ok = r.status === 200 && (await r.json())["hub.challenge"] === challenge;
      } catch { /* unreachable */ }
      if (!ok) return send(res, 400, { message: "Bad Request", errors: [{ resource: "PushSubscription", code: "GET to callback URL does not return 200" }] });
      state.subscription = { id: 7, callback_url: form.get("callback_url") };
      return send(res, 201, { id: 7 });
    }
  }

  // API: bearer must be the latest issued access token
  if (p.startsWith("/api/v3/")) {
    if (req.headers.authorization !== `Bearer ${state.access}`) { state.badBearer++; return send(res, 401, { message: "Authorization Error" }); }
    if (state.rateLimitNext > 0) {
      state.rateLimitNext--;
      return send(res, 429, { message: "Rate Limit Exceeded" }, { "X-ReadRateLimit-Usage": "101,300" });
    }
    if (p === "/api/v3/athlete/activities") {
      const page = Number(url.searchParams.get("page") || 1), per = Number(url.searchParams.get("per_page") || 30);
      state.listRequests.push({ after: Number(url.searchParams.get("after")), page, per });
      const all = [...state.activities.values()].sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
      return send(res, 200, all.slice((page - 1) * per, page * per));
    }
    const m = p.match(/^\/api\/v3\/activities\/(\d+)$/);
    if (m) {
      state.activityRequests++;
      const a = state.activities.get(Number(m[1]));
      return a ? send(res, 200, a) : send(res, 404, { message: "Record Not Found" });
    }
  }
  send(res, 404, { message: "not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`fake strava on ${PORT}`));
