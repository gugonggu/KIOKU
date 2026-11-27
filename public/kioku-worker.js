const CACHE = "kioku-offline-shell-v4";
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

async function launch(request, launchPage) {
  let reply;
  try {
    reply = await fetch(request);
    if (reply.status < 500 || !launchPage) return reply;
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
  // Trip pages always come from the network. When it fails, show the static offline shell, never cached account HTML.
  if (request.mode === "navigate" && (url.pathname === "/trips" || url.pathname.startsWith("/trips/"))) {
    event.respondWith(launch(request, url.pathname === "/trips"));
    return;
  }
  if (!SHELL.includes(url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(url.pathname)) ?? fetch(request)));
});
