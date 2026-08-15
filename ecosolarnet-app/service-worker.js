const CACHE_NAME = "ecosolarnet-v83";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/db.js",
  "./js/config.js",
  "./js/musicLibrary.js",
  "./js/firebaseConfig.js",
  "./js/firebaseSync.js",
  "./js/geo.js",
  "./js/photo.js",
  "./js/scheduling.js",
  "./js/timer.js",
  "./js/routing.js",
  "./js/departureReminder.js",
  "./js/addressAutocomplete.js",
  "./js/qrcode.js",
  "./js/weather.js",
  "./js/huggyTips.js",
  "./js/huggyVoice.js",
  "./js/toast.js",
  "./js/gmailAuth.js",
  "./js/gmail.js",
  "./js/backup.js",
  "./js/paymentQr.js",
  "./js/views/dashboard.js",
  "./js/views/clients.js",
  "./js/views/devis.js",
  "./js/views/planning.js",
  "./js/views/calendar.js",
  "./js/views/waitlist.js",
  "./js/views/settings.js",
  "./js/views/emails.js",
  "./js/views/whatsapp.js",
  "./js/views/socialpost.js",
  "./js/views/qrcodes.js",
  "./js/views/assistant.js",
  "./js/views/reminders.js",
  "./js/views/ideas.js",
  "./js/views/more.js",
  "./js/vendor/jspdf.umd.min.js",
  "./js/vendor/qrcode.min.js",
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

  // Ne jamais mettre en cache les appels aux services externes (géocodage,
  // météo, routage) : on veut toujours des données fraîches, jamais périmées.
  const EXTERNAL_HOSTS = [
    "nominatim.openstreetmap.org",
    "api.open-meteo.com",
    "router.project-osrm.org",
    "gmail.googleapis.com",
    "accounts.google.com",
  ];
  if (EXTERNAL_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.method !== "GET") return;

  // Réseau en priorité pour toujours servir la dernière version de l'appli
  // quand la connexion est disponible ; le cache ne sert que de secours hors-ligne.
  event.respondWith(
    fetch(event.request, { cache: "reload" })
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
