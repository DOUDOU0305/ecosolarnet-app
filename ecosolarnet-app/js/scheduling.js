import { haversineKm, postalCodeRoughDistance, classifyRegion } from "./geo.js";

const MAX_JUMP_KM = 20; // au-delà, on ne regroupe plus sur la même journée même s'il reste de la place

// Vocabulaire partagé pour la fréquence d'un abonnement (clients.js et
// devis.js utilisaient chacun leur propre libellé, ce qui les faisait
// diverger — ex. "Tous les 3 mois" ici, "Trimestriel" là).
export const FREQUENCY_LABELS = {
  hebdomadaire: "Hebdomadaire",
  mensuel: "Mensuel",
  bimestriel: "Bimestriel",
  trimestriel: "Trimestriel",
  semestriel: "Semestriel",
  annuel: "Annuel",
};

function distanceBetween(from, item, base) {
  const fromCoord = from && from.lat != null ? from : base;
  const itemCoord = item.lat != null ? { lat: item.lat, lng: item.lng } : null;
  if (fromCoord && itemCoord) {
    const d = haversineKm(fromCoord, itemCoord);
    if (d != null) return d;
  }
  return postalCodeRoughDistance(from?.postalCode || "0", item.postalCode);
}

// Regroupe des items (avec lat/lng et/ou postalCode) en paquets ordonnés par
// proximité, chaque paquet contenant au maximum maxPerDay éléments. On sépare
// d'abord par région (Hainaut/Bruxelles/Autre) puis on limite les sauts de
// distance au sein d'un même paquet, pour éviter de mélanger des secteurs
// éloignés simplement parce qu'il reste de la place ce jour-là.
//
// Chaque nouveau client ajouté à un paquet est choisi par sa distance au
// membre le PLUS PROCHE déjà dans le paquet (pas seulement au dernier
// ajouté) : deux clients réellement voisins finissent donc toujours
// ensemble, même si un autre client se trouvait sur le chemin "idéal" entre
// les deux — sinon ce dernier pouvait les "doubler" et les séparer sur des
// jours différents (signalé par Steve le 2026-09-20 : deux clients à 5 min
// l'un de l'autre placés à 3 jours d'écart).
export function clusterByProximity(items, maxPerDay, base) {
  const byRegion = new Map();
  for (const item of items) {
    const region = classifyRegion(item.postalCode);
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region).push(item);
  }

  const clusters = [];
  for (const [, regionItems] of byRegion) {
    const remaining = [...regionItems];
    while (remaining.length > 0) {
      // Amorce le paquet avec le client le plus proche de la base (point de
      // départ le plus logique pour une tournée).
      let seedIdx = 0;
      let seedDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = distanceBetween(base, remaining[i], base);
        if (d < seedDist) {
          seedDist = d;
          seedIdx = i;
        }
      }
      const cluster = remaining.splice(seedIdx, 1);

      while (cluster.length < maxPerDay && remaining.length > 0) {
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < remaining.length; i++) {
          for (const member of cluster) {
            const d = distanceBetween(member, remaining[i], base);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = i;
            }
          }
        }
        if (bestIdx === -1 || bestDist > MAX_JUMP_KM) break;
        const [next] = remaining.splice(bestIdx, 1);
        cluster.push(next);
      }
      clusters.push(cluster);
    }
  }
  return clusters;
}

export function clusterKm(cluster, base) {
  let km = 0;
  let current = base;
  const remaining = [...cluster];
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceBetween(current, remaining[i], base);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    km += bestDist;
    current = remaining[bestIdx].lat != null ? { lat: remaining[bestIdx].lat, lng: remaining[bestIdx].lng } : current;
    remaining.splice(bestIdx, 1);
  }
  if (base && current) {
    const back = current.lat != null ? haversineKm(current, base) : null;
    km += back != null ? back : 5;
  }
  return km;
}

// Jours ouvrés (selon settings.workDays) du mois donné ("YYYY-MM"), à partir
// d'aujourd'hui, qui n'ont pas déjà une entrée de planning.
export function freeWorkdaysInMonth(monthStr, settings, existingDatesSet) {
  const [year, month] = monthStr.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);
  const free = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (dateStr < todayStr) continue;
    if (!settings.workDays.includes(weekdayOf(dateStr))) continue;
    if (existingDatesSet.has(dateStr)) continue;
    free.push(dateStr);
  }
  return free;
}

// Lundi = 1 ... Dimanche = 7 (ISO)
export function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  return wd === 0 ? 7 : wd;
}

export function nextMonthStr(monthStr) {
  const [year, month] = monthStr.split("-").map(Number);
  const d = new Date(year, month, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(monthStr) {
  const [year, month] = monthStr.split("-").map(Number);
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("fr-BE", { month: "long", year: "numeric" });
}

// Préférence de jour de semaine pour un client/secteur, basée sur les
// corrections manuelles précédentes.
export function preferenceKeyFor(entry) {
  return entry.clientId ? `client:${entry.clientId}` : `pc:${entry.postalCode}`;
}

export function pickBestDay(cluster, freeDays, preferences) {
  const votes = {};
  for (const item of cluster) {
    const pref = preferences[preferenceKeyFor(item)];
    if (pref) votes[pref.weekday] = (votes[pref.weekday] || 0) + 1;
  }
  const sortedWeekdays = Object.entries(votes).sort((a, b) => b[1] - a[1]).map(([wd]) => Number(wd));
  for (const wd of sortedWeekdays) {
    const match = freeDays.find((d) => weekdayOf(d) === wd);
    if (match) return match;
  }
  return freeDays[0];
}
