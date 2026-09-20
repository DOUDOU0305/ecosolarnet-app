import { haversineKm, postalCodeRoughDistance } from "./geo.js";

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

// Distance minimale entre deux groupes (le couple de membres le plus proche
// entre l'un et l'autre) — sert à décider quelle paire de groupes fusionner.
function groupDistance(groupA, groupB, base) {
  let d = Infinity;
  for (const a of groupA) {
    for (const b of groupB) {
      const dd = distanceBetween(a, b, base);
      if (dd < d) d = dd;
    }
  }
  return d;
}

// Regroupe des items (avec lat/lng et/ou postalCode/city) en paquets d'au
// plus maxPerDay éléments, un paquet = un jour de tournée. Groupe D'ABORD
// par ville (voir localityKey) — tous les clients de Namur ensemble, tous
// ceux de Mettet ensemble — demande explicite de Steve (2026-09-20) : un
// groupe de ville n'est JAMAIS coupé en deux jours, sauf s'il dépasse
// maxPerDay à lui seul (impossible de faire autrement dans ce cas).
//
// Les groupes de ville sont ensuite assemblés en paquets par fusion
// agglomérative : à chaque étape, on fusionne la PAIRE de groupes encore
// séparés la plus proche l'une de l'autre (peu importe l'ordre où ils ont
// été découverts), tant que la fusion tient dans maxPerDay. Une première
// version traitait les groupes dans un ordre fixe (proximité à la base) et
// laissait chaque paquet "réclamer" le premier groupe compatible trouvé —
// ce qui pouvait attribuer un groupe à un paquet simplement parce que son
// tour venait avant, même si un autre paquet pas encore formé aurait été
// objectivement plus proche. Vérifié avec les vraies coordonnées le
// 2026-09-20 : Harmony-Jean (Sambreville) est à 6 km de Julie/Yume
// (Farciennes) mais à 13 km de Claire/Servi-therm (Mettet) — la fusion par
// paire la plus proche globalement les regroupe correctement, l'ancienne
// version non. Chaque paquet est ensuite réordonné en trajet cohérent
// (orderAsRoute) avant d'être renvoyé.
export function clusterByProximity(items, maxPerDay, base) {
  // Pas de pré-découpage par "région" (Hainaut/Bruxelles/Autre) : ce
  // classement sert au calcul du TARIF horaire (devis.js), pas à la
  // proximité réelle. Un ancien passage de cette fonction s'en servait
  // encore ici et empêchait à tort deux secteurs voisins mais dans des
  // tranches de code postal différentes de se rassembler — ex. Farciennes
  // (6240, classé "Hainaut") ne pouvait jamais rejoindre Sambreville (5060,
  // classé "Autre") alors qu'ils sont à 6 km l'un de l'autre. Signalé par
  // Steve le 2026-09-20 après vérification directe sur coordonnées réelles.
  const byLocality = new Map();
  for (const item of items) {
    const key = localityKey(item);
    if (!byLocality.has(key)) byLocality.set(key, []);
    byLocality.get(key).push(item);
  }
  const active = [...byLocality.values()].map((groupItems) => [...groupItems]);
  const clusters = [];

  while (active.length > 0) {
    if (active.length === 1) {
      const [only] = active.splice(0, 1);
      const remaining = [...only];
      while (remaining.length > 0) clusters.push(remaining.splice(0, maxPerDay));
      break;
    }

    let bestI = -1;
    let bestJ = -1;
    let bestDist = Infinity;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        if (active[i].length + active[j].length > maxPerDay) continue;
        const d = groupDistance(active[i], active[j], base);
        if (d < bestDist) {
          bestDist = d;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestI === -1) {
      // Aucune paire ne peut plus fusionner (tout ce qui reste est trop
      // grand ou dépasserait maxPerDay) : chaque groupe restant devient
      // son ou ses propres paquets.
      for (const g of active) {
        const remaining = [...g];
        while (remaining.length > 0) clusters.push(remaining.splice(0, maxPerDay));
      }
      break;
    }

    active[bestI] = active[bestI].concat(active[bestJ]);
    active.splice(bestJ, 1);
    if (active[bestI].length >= maxPerDay) {
      clusters.push(active[bestI]);
      active.splice(bestI, 1);
    }
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
