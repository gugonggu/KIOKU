const CACHE = "kioku-offline-shell-v2";
const SHELL = ["/offline.html", "/offline.css", "/offline.js", "/offline-store.js",
  "/kioku-icon-192.png", "/kioku-icon-512.png", "/kioku-maskable-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) =>
    cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload", credentials: "omit" })))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith("kioku-offline-shell-") && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data === "activate-update") void self.skipWaiting();
});

async function launch(request) {
  let reply;
  try {
    reply = await fetch(request);
    if (reply.status < 500) return reply;
  } catch {
    // The cached public shell is usable when the network is unavailable.
  }
  const shell = await (await caches.open(CACHE)).match("/offline.html");
  return shell ?? reply ?? Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && url.pathname === "/trips" && !url.search) {
    event.respondWith(launch(request));
    return;
  }
  if (!SHELL.includes(url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(url.pathname)) ?? fetch(request)));
});
