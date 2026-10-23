/* Service Worker — آکادمی شبکه و نظارت تصویری
 *-first برای هستهٔ برنامه، network-first برای ناوبری (به‌روزرسانی خودکار بعد از آنلاین شدن). */
"use strict";
const CACHE = "cctv-academy-v1";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./assets/data/cctv-data.js",
  "./manifest.json",
  "./fonts/vazirmatn-arabic-var.woff2",
  "./fonts/vazirmatn-latin-var.woff2",
  "./fonts/vazirmatn.css",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* تک‌تک کش می‌شوند تا خطای یکی بقیه را از بین نبرد؛ بقیهٔ هسته و index.html حتماً اینجاست. */
    const results = await Promise.allSettled(CORE_ASSETS.map((url) => cache.add(new Request(url, { cache: "reload" }))));
    if (!results.some((r) => r.status === "fulfilled")) throw new Error("no core asset cached");
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // درخواست‌های خارجی: گذر مستقیم
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match(request, { ignoreSearch: true })) ||
          (await cache.match("index.html", { ignoreSearch: true })) ||
          (await cache.match("./", { ignoreSearch: true })) ||
          new Response("<!doctype html><meta charset=utf-8><title>آفلاین</title><p>برنامه هنوز کاملاً ذخیره نشده؛ یک بار در حالت آنلاین بازش کن.</p>", { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    })());
    return;
  }
  // بقیهٔ منابع هم‌مبدأ: cache-first
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && response.ok && response.type === "basic") cache.put(request, response.clone());
      return response;
    } catch (error) {
      return new Response("", { status: 504, statusText: "offline" });
    }
  })());
});
