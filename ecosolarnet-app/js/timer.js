import { Store } from "./db.js";
import { haversineKm } from "./geo.js";

const ARRIVE_RADIUS_M = 70;
const LEAVE_RADIUS_M = 150;
const ARRIVE_DWELL_MS = 45_000;
const LEAVE_DWELL_MS = 120_000;

let watchId = null;
let nearCandidate = null; // { clientId, since }
let farSince = null;
let listeners = [];

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

// --- Détection automatique par GPS (uniquement pendant que l'appli est ouverte) ---

export function isAutoWatching() {
  return watchId != null;
}

export async function startAutoWatch() {
  if (watchId != null) return;
  if (!("geolocation" in navigator)) {
    emit("error", "GPS non disponible sur cet appareil.");
    return;
  }
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
    let closest = null;
    let closestDist = Infinity;
    for (const c of withCoords) {
      const d = haversineKm(here, { lat: c.lat, lng: c.lng }) * 1000;
      if (d < closestDist) {
        closestDist = d;
        closest = c;
      }
    }
    if (closest && closestDist <= ARRIVE_RADIUS_M) {
      if (nearCandidate && nearCandidate.clientId === closest.id) {
        if (Date.now() - nearCandidate.since >= ARRIVE_DWELL_MS) {
          await startVisit(closest, true);
          nearCandidate = null;
        }
      } else {
        nearCandidate = { clientId: closest.id, since: Date.now() };
      }
    } else {
      nearCandidate = null;
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
