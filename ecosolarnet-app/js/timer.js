import { Store } from "./db.js";
import { haversineKm } from "./geo.js";

const ARRIVE_RADIUS_M = 70;
const CONFIRM_RADIUS_M = 150; // rayon large : "je suis dans le coin", à confirmer si l'agenda ne tranche pas
const LEAVE_RADIUS_M = 150;
const ARRIVE_DWELL_MS = 45_000;
const LEAVE_DWELL_MS = 120_000;
const DISMISS_MS = 15 * 60_000; // après un "Non", on ne redemande pas pour ce client avant 15 min

let watchId = null;
let nearCandidate = null; // { clientId, since }
let farSince = null;
let listeners = [];
let pendingArrival = null; // { clientId, clientName, position }
const dismissedUntil = new Map(); // clientId -> timestamp

export function onTimerEvent(cb) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

function emit(event, data) {
  listeners.forEach((cb) => {
    try {
      cb(event, data);
    } catch {
      // un listener qui plante ne doit pas casser le suivi GPS
    }
  });
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return `${hh}h${mm}:${ss}`;
}

export async function getActiveTimer() {
  return Store.get("activeTimer", "current");
}

export async function startVisit(client, auto = false) {
  const existing = await getActiveTimer();
  if (existing) return existing;
  const record = {
    id: "current",
    clientId: client.id ?? null,
    clientName: client.name,
    startTime: new Date().toISOString(),
    auto,
  };
  await Store.put("activeTimer", record);
  emit("start", record);
  return record;
}

// Appelé quand Steve appuie sur un bouton "🚗 Waze" pour se rendre chez un
// client : s'il y a un chrono en cours chez un AUTRE client, ça veut dire
// qu'il quitte ce chantier pour partir vers le suivant — on arrête ce
// chrono-là tout de suite. Ne dépend pas du suivi GPS en arrière-plan
// (qui se met en pause une fois Waze ouvert) puisque ça se déclenche
// pendant que l'app est encore au premier plan, juste avant de basculer.
export async function stopVisitForDifferentClient(targetClientId) {
  const active = await getActiveTimer();
  if (active && active.clientId && active.clientId !== targetClientId) {
    await stopVisit();
  }
}

export async function stopVisit() {
  const active = await getActiveTimer();
  if (!active) return null;
  const endTime = new Date().toISOString();
  const durationSeconds = Math.round((new Date(endTime) - new Date(active.startTime)) / 1000);
  const visit = {
    clientId: active.clientId,
    clientName: active.clientName,
    date: active.startTime.slice(0, 10),
    startTime: active.startTime,
    endTime,
    durationSeconds,
    auto: active.auto,
  };
  await Store.put("visits", visit);
  await Store.delete("activeTimer", "current");
  emit("stop", visit);
  return visit;
}

export async function cancelVisit() {
  await Store.delete("activeTimer", "current");
  emit("cancel");
}

// Appelé quand Steve répond à la question "Êtes-vous chez X ?" affichée
// après une arrivée GPS incertaine (adresse ambiguë ou géocodage imprécis).
// Le chrono a déjà démarré dès l'arrivée (voir handlePosition) pour ne pas
// dépendre d'une réponse immédiate : "Oui" le laisse enregistré tel quel,
// "Non" l'efface complètement (ce n'était pas le bon client).
export async function resolveArrivalConfirm(clientId, confirmed) {
  if (!pendingArrival || pendingArrival.clientId !== clientId) return;
  const { position } = pendingArrival;
  pendingArrival = null;
  const active = await getActiveTimer();
  if (!confirmed) {
    if (active && active.clientId === clientId) await cancelVisit();
    dismissedUntil.set(clientId, Date.now() + DISMISS_MS);
    return;
  }
  const client = await Store.get("clients", clientId);
  if (!client || client.lat == null) return;
  // La position confirmée par Steve fait foi : si l'adresse géocodée du
  // client a dérivé, on la recale dessus pour que la prochaine détection
  // automatique soit plus précise (moins de "Oui/Non" à répondre).
  const drift = haversineKm(position, { lat: client.lat, lng: client.lng }) * 1000;
  if (drift > 30) {
    client.lat = position.lat;
    client.lng = position.lng;
    await Store.put("clients", client);
  }
}

// Prochains clients du jour non encore visités, dans l'ordre de la tournée
// programmée — sert à départager quand plusieurs clients sont proches
// géographiquement (ex. même rue).
async function getTodayQueue() {
  const dateStr = new Date().toISOString().slice(0, 10);
  const [entries, times, visitsToday, clients] = await Promise.all([
    Store.getAll("planningEntries"),
    Store.getAll("visitTimes"),
    Store.getAll("visits"),
    Store.getAll("clients"),
  ]);
  const entry = entries.find((p) => p.date === dateStr);
  if (!entry || !entry.tourneeId) return [];
  const tournee = await Store.get("tournees", entry.tourneeId);
  if (!tournee) return [];
  const visitedIds = new Set(visitsToday.filter((v) => v.date === dateStr).map((v) => v.clientId));
  const timesMap = new Map(times.filter((v) => v.date === dateStr).map((v) => [v.clientId, v.startMinutes]));
  return tournee.clientIds
    .map((id, i) => {
      const c = clients.find((x) => x.id === id);
      if (!c || c.lat == null || visitedIds.has(id)) return null;
      return { id, startMinutes: timesMap.has(id) ? timesMap.get(id) : i };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinutes - b.startMinutes);
}

// --- Détection automatique par GPS (uniquement pendant que l'appli est ouverte) ---

export function isAutoWatching() {
  return watchId != null;
}

// Renvoie une promesse qui échoue si la permission GPS est refusée ou
// indisponible, plutôt que de démarrer le suivi en aveugle : watchPosition()
// renvoie un identifiant tout de suite, avant même de savoir si la
// permission a été accordée, donc s'y fier seul donnait un faux "ça marche"
// même quand ce n'était pas le cas (ex : permission manquante côté iOS).
export async function startAutoWatch() {
  if (watchId != null) return;
  if (!("geolocation" in navigator)) {
    const msg = "GPS non disponible sur cet appareil.";
    emit("error", msg);
    throw new Error(msg);
  }

  await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(),
      (err) => reject(new Error("Permission GPS refusée ou indisponible : " + err.message)),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });

  watchId = navigator.geolocation.watchPosition(
    handlePosition,
    (err) => emit("error", "Erreur GPS : " + err.message),
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
  );
  emit("watch-start");
}

export function stopAutoWatch() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  nearCandidate = null;
  farSince = null;
  emit("watch-stop");
}

async function handlePosition(position) {
  const { latitude, longitude } = position.coords;
  const here = { lat: latitude, lng: longitude };
  const active = await getActiveTimer();
  const clients = await Store.getAll("clients");
  const withCoords = clients.filter((c) => c.lat != null);

  if (!active) {
    const withinConfirm = withCoords
      .map((c) => ({ c, d: haversineKm(here, { lat: c.lat, lng: c.lng }) * 1000 }))
      .filter((x) => x.d <= CONFIRM_RADIUS_M)
      .sort((a, b) => a.d - b.d);

    if (withinConfirm.length === 0) {
      nearCandidate = null;
      return;
    }

    let target;
    let targetDist;
    let confident;
    if (withinConfirm.length === 1) {
      ({ c: target, d: targetDist } = withinConfirm[0]);
      confident = targetDist <= ARRIVE_RADIUS_M;
    } else {
      // Plusieurs clients proches (ex. même rue) : on se fie à l'ordre de la
      // tournée du jour pour savoir chez lequel Steve se rend réellement.
      const queue = await getTodayQueue();
      const queueIndex = new Map(queue.map((c, i) => [c.id, i]));
      const inQueue = withinConfirm.filter((x) => queueIndex.has(x.c.id));
      const pick = inQueue.length > 0
        ? inQueue.reduce((a, b) => (queueIndex.get(a.c.id) < queueIndex.get(b.c.id) ? a : b))
        : withinConfirm[0];
      target = pick.c;
      targetDist = pick.d;
      confident = inQueue.length === 1 && targetDist <= ARRIVE_RADIUS_M;
    }

    if ((dismissedUntil.get(target.id) || 0) > Date.now()) {
      nearCandidate = null;
      return;
    }

    if (nearCandidate && nearCandidate.clientId === target.id) {
      if (Date.now() - nearCandidate.since >= ARRIVE_DWELL_MS) {
        if (confident) {
          await startVisit(target, true);
        } else if (!pendingArrival || pendingArrival.clientId !== target.id) {
          // On démarre le chrono tout de suite, sans attendre la réponse :
          // si Steve ne répond pas à "Êtes-vous chez X ?", le temps est déjà
          // compté. "Oui" laisse le chrono tel quel, "Non" l'efface.
          await startVisit(target, true);
          pendingArrival = { clientId: target.id, clientName: target.name, position: here };
          emit("confirm-arrival", { clientId: target.id, clientName: target.name });
        }
        nearCandidate = null;
      }
    } else {
      nearCandidate = { clientId: target.id, since: Date.now() };
    }
  } else {
    const client = withCoords.find((c) => c.id === active.clientId);
    if (client) {
      const d = haversineKm(here, { lat: client.lat, lng: client.lng }) * 1000;
      if (d > LEAVE_RADIUS_M) {
        if (farSince == null) farSince = Date.now();
        else if (Date.now() - farSince >= LEAVE_DWELL_MS) {
          await stopVisit();
          farSince = null;
        }
      } else {
        farSince = null;
      }
    }
  }
}
