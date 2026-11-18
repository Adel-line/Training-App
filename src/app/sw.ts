/// <reference lib="webworker" />
import { CacheFirst, ExpirationPlugin, NetworkOnly, Serwist, StaleWhileRevalidate, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

/**
 * Only static, user-independent assets are cached. HTML and RSC responses are
 * never stored: they contain private data and must not outlive a sign-out.
 * Offline workout data lives in an owner-scoped IndexedDB store (milestone 3).
 */
const serwist: Serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      // The workout screen is a static, data-free page that reads the phone's local database,
      // so the precached copy is served whenever the network is unavailable.
      matcher: ({ request, url }) => request.mode === "navigate" && url.pathname === "/workout",
      handler: async ({ request }): Promise<Response> => {
        try {
          return await fetch(request);
        } catch {
          return (await serwist.matchPrecache("/workout")) ?? Response.error();
        }
      },
    },
    {
      // Navigations always go to the network (never cached); the `fallbacks`
      // entry below swaps in the precached offline shell when that fails.
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "next-static",
        plugins: [new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: 30 * 24 * 3600 })],
      }),
    },
    {
      matcher: ({ url }) => url.pathname.startsWith("/icons/"),
      handler: new StaleWhileRevalidate({ cacheName: "icons" }),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
