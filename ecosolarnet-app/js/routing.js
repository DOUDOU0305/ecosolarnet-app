import { haversineKm } from "./geo.js";

const FALLBACK_SPEED_KMH = 40;

// Temps de trajet estimé en minutes entre deux points, via le service de
// routage OSRM (gratuit, sans clé). En cas d'échec (hors ligne, service
// indisponible), on retombe sur une estimation grossière à vol d'oiseau.
export async function estimateTravelMinutes(from, to) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const seconds = data.routes?.[0]?.duration;
      if (seconds != null) return seconds / 60;
    }
  } catch {
    // pas grave, on utilise l'estimation de secours ci-dessous
  }
  const km = haversineKm(from, to) || 0;
  return (km / FALLBACK_SPEED_KMH) * 60;
}
