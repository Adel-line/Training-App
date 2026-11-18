import http from "node:http";
import { webhookPort } from "./config.ts";
import { handleWebhookRequest } from "./webhookHttp.ts";

const g = globalThis as unknown as { __stravaListener?: http.Server };
const MAX_BODY = 64 * 1024;

/**
 * A tiny HTTP server that serves ONLY /api/strava/webhook, bound to 127.0.0.1 on its own port.
 * Expose this port (not the app) to the internet, so Strava can reach the webhook while the rest of
 * the app stays private. See README.
 */
export function startWebhookListener(): void {
  if (g.__stravaListener) return;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body?: { json?: unknown; text?: string }) => {
      if (body?.json !== undefined) {
        res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body.json));
      } else res.writeHead(status, { "Content-Type": "text/plain" }).end(body?.text ?? "");
    };
    if (url.pathname !== "/api/strava/webhook") return send(404, { text: "Not found" });

    const readBody = () =>
      new Promise<unknown>((resolve) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY) {
            req.destroy();
            return resolve(null);
          }
          chunks.push(c);
        });
        req.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
          } catch {
            resolve(null);
          }
        });
        req.on("error", () => resolve(null));
      });

    Promise.resolve(handleWebhookRequest(req.method ?? "GET", url.searchParams, readBody))
      .then((r) => send(r.status, { json: r.json, text: r.text }))
      .catch((e) => {
        console.error("webhook error:", (e as Error).message);
        send(500, { text: "Server error" });
      });
  });
  server.on("error", (e: NodeJS.ErrnoException) => {
    console.error(e.code === "EADDRINUSE" ? `Webhook port ${webhookPort()} is already in use` : `Webhook listener error: ${e.message}`);
    g.__stravaListener = undefined;
  });
  server.listen(webhookPort(), "127.0.0.1");
  server.unref();
  g.__stravaListener = server;
}
