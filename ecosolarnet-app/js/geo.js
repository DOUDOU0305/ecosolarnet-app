// Classification région (Belgique) à partir du code postal.
// Bruxelles-Capitale : 1000-1210. Hainaut : 6000-6599 et 7000-7999.
export function classifyRegion(postalCode) {
  const pc = parseInt(postalCode, 10);
  if (!pc) return "Autre";
  if (pc >= 1000 && pc <= 1210) return "Bruxelles";
  if ((pc >= 6000 && pc <= 6599) || (pc >= 7000 && pc <= 7999)) return "Hainaut";
  return "Autre";
}

export function regionRateRange(region, settings) {
  if (region === "Bruxelles") return [settings.rateBruxellesMin, settings.rateBruxellesMax];
  if (region === "Hainaut") return [settings.rateHainautMin, settings.rateHainautMax];
  // Fallback: prudence, on prend le taux le plus élevé connu pour ne pas sous-facturer.
  return [settings.rateHainautMax, settings.rateBruxellesMax];
}

// Géocodage via Nominatim (OpenStreetMap), gratuit, sans clé.
// Usage léger uniquement (max ~1 requête/seconde), résultats mis en cache par l'appelant.
const geocodeQueue = [];
let geocodeBusy = false;

function runQueue() {
  if (geocodeBusy || geocodeQueue.length === 0) return;
  geocodeBusy = true;
  const { address, resolve, reject } = geocodeQueue.shift();
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=be&q=${encodeURIComponent(address)}`;
  fetch(url, { headers: { Accept: "application/json" } })
    .then((r) => r.json())
    .then((data) => {
      if (data && data[0]) {
        resolve({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) });
      } else {
        resolve(null);
      }
    })
    .catch(reject)
    .finally(() => {
      geocodeBusy = false;
      setTimeout(runQueue, 1100);
    });
}

export function geocodeAddress(address) {
  return new Promise((resolve, reject) => {
    geocodeQueue.push({ address, resolve, reject });
    runQueue();
  });
}

export function haversineKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Distance approximative entre deux codes postaux quand les coordonnées manquent,
// basée uniquement sur l'écart numérique (repli grossier, mieux que rien).
export function postalCodeRoughDistance(pc1, pc2) {
  const a = parseInt(pc1, 10);
  const b = parseInt(pc2, 10);
  if (!a || !b) return 999;
  return Math.abs(a - b) / 10;
}

export function fullAddress(entity) {
  return `${entity.address}, ${entity.postalCode} ${entity.city}, Belgique`;
}

export function wazeUrl(c) {
  if (c.lat != null && c.lng != null) {
    return `https://waze.com/ul?ll=${c.lat}%2C${c.lng}&navigate=yes`;
  }
  const address = [c.address, c.postalCode, c.city].filter(Boolean).join(", ");
  return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
}
