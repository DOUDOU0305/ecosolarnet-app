import { haversineKm, postalCodeRoughDistance, classifyRegion } from "./geo.js";

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

// Une ville comme Namur s'étale sur plusieurs codes postaux (5000, 5001,
// 5004...) — grouper par code postal EXACT (tentative précédente,
// 2026-09-20) les traitait à tort comme des secteurs différents, ce qui
// pouvait les faire séparer par un groupe d'une autre ville intercalé entre
// deux. On groupe donc par nom de ville (normalisé), qui correspond
// directement à ce que Steve demande ("tous les clients de Namur
// ensemble") ; repli sur le code postal si la ville est absente.
function localityKey(item) {
  const city = (item.city || "").trim().toLowerCase();
  return city || `cp-${item.postalCode || ""}`;
}

// Ordonne un paquet de clients en un trajet cohérent (plus proche voisin en
// partant de la base) pour que l'ORDRE DE VISITE affiché ne fasse jamais
// d'aller-retour, même quand deux villes différentes partagent la même
// journée (signalé par Steve : "on passe de Namur à Sambreville, on revient
// sur Namur, puis Mettet, puis Gerpinnes" — le regroupement par ville seul
// ne suffit pas si l'ordre à l'intérieur du paquet n'est pas aussi trié).
function orderAsRoute(cluster, base) {
  const remaining = [...cluster];
  const route = [];
  let current = base;
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
    const [next] = remaining.splice(bestIdx, 1);
    route.push(next);
    current = next.lat != null ? { lat: next.lat, lng: next.lng } : current;
  }
  return route;
}

// Regroupe des items (avec lat/lng et/ou postalCode/city) en paquets d'au
// plus maxPerDay éléments, un paquet = un jour de tournée. Groupe D'ABORD
// par ville (voir localityKey) — tous les clients de Namur ensemble, tous
// ceux de Mettet ensemble — demande explicite de Steve (2026-09-20). Les
// groupes de ville sont ensuite ordonnés par proximité à la base (départ),
// et remplissent les paquets dans cet ordre : un groupe reste entièrement
// contigu dans un même paquet sauf s'il dépasse maxPerDay à lui seul, et le
// reste de place d'un paquet est comblé par le groupe de ville suivant le
// plus proche plutôt que laissé vide. Chaque paquet est ensuite réordonné
// en trajet cohérent (orderAsRoute) avant d'être renvoyé.
export function clusterByProximity(items, maxPerDay, base) {
  const byRegion = new Map();
  for (const item of items) {
    const region = classifyRegion(item.postalCode);
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region).push(item);
  }

  const clusters = [];
  for (const [, regionItems] of byRegion) {
    const byLocality = new Map();
    for (const item of regionItems) {
      const key = localityKey(item);
      if (!byLocality.has(key)) byLocality.set(key, []);
      byLocality.get(key).push(item);
    }
    const localityGroups = [...byLocality.values()]
      .map((groupItems) => ({
        items: groupItems,
        dist: Math.min(...groupItems.map((it) => distanceBetween(base, it, base))),
      }))
      .sort((a, b) => a.dist - b.dist);

    let cluster = [];
    for (const group of localityGroups) {
      const remaining = [...group.items];
      while (remaining.length > 0) {
        if (cluster.length >= maxPerDay) {
          clusters.push(cluster);
          cluster = [];
        }
        const take = remaining.splice(0, maxPerDay - cluster.length);
        cluster.push(...take);
      }
    }
    if (cluster.length > 0) clusters.push(cluster);
  }
  return clusters.map((cluster) => orderAsRoute(cluster, base));
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
