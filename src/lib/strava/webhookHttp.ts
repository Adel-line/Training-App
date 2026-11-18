import { getDb } from "../db.ts";
import { verifyToken } from "./config.ts";
import { kick } from "./scheduler.ts";
import { handleEvent, handleVerification, type WebhookResult } from "./webhook.ts";

/** Shared by the Next route handler and the standalone public listener. */
export function handleWebhookRequest(method: string, query: URLSearchParams, readBody: () => Promise<unknown>): Promise<WebhookResult> | WebhookResult {
  if (method === "GET") return handleVerification(query, verifyToken());
  if (method === "POST") {
    return readBody().then((body) => {
      const r = handleEvent(getDb(), body);
      if (r.enqueued) kick(); // start importing right away; the 200 doesn't wait for it
      return r;
    });
  }
  return { status: 405, text: "Method not allowed" };
}
