const CACHE_NAME = "ecosolarnet-v9";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/db.js",
  "./js/geo.js",
  "./js/photo.js",
  "./js/scheduling.js",
  "./js/timer.js",
  "./js/addressAutocomplete.js",
  "./js/toast.js",
  "./js/views/dashboard.js",
  "./js/views/clients.js",
  "./js/views/devis.js",
  "./js/views/planning.js",
  "./js/views/calendar.js",
  "./js/views/waitlist.js",
  "./js/views/settings.js",
  "./js/vendor/jspdf.umd.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Ne jamais mettre en cache les appels de géocodage externes.
  if (url.hostname.includes("nominatim.openstreetmap.org")) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.method !== "GET") return;

  // Réseau en priorité pour toujours servir la dernière version de l'appli
  // quand la connexion est disponible ; le cache ne sert que de secours hors-ligne.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
