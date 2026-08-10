import { Store, getSettings } from "./db.js";
import { estimateTravelMinutes } from "./routing.js";

const CHECK_EVERY_MS = 60_000;
const BUFFER_MINUTES = 5;

let checkInterval = null;
let notifiedToday = new Set();
let lastCheckedDate = null;
let listeners = [];

export function onDepartureEvent(cb) {
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
      // un listener qui plante ne doit pas casser les alertes
    }
  });
}

export function fmtMinutesOfDay(m) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}H${String(mm).padStart(2, "0")}`;
}

export function isRunning() {
  return checkInterval != null;
}

export function startDepartureReminders() {
  if (checkInterval != null) return;
  checkOnce();
  checkInterval = setInterval(checkOnce, CHECK_EVERY_MS);
}

export function stopDepartureReminders() {
  if (checkInterval != null) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return Notification.requestPermission();
}

async function checkOnce() {
  const todayStr = new Date().toISOString().slice(0, 10);
  if (lastCheckedDate !== todayStr) {
    notifiedToday.clear();
    lastCheckedDate = todayStr;
  }

  const allTimes = await Store.getAll("visitTimes");
  const todayAppts = allTimes.filter((v) => v.date === todayStr).sort((a, b) => a.startMinutes - b.startMinutes);
  if (todayAppts.length === 0) return;

  const settings = await getSettings();
  const clients = await Store.getAll("clients");
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const base = settings.baseLat != null ? { lat: settings.baseLat, lng: settings.baseLng } : null;

  for (let i = 0; i < todayAppts.length; i++) {
    const appt = todayAppts[i];
    if (notifiedToday.has(appt.id)) continue;
    if (appt.startMinutes <= nowMinutes) continue;

    let fromLoc;
    if (i === 0) {
      fromLoc = base;
    } else {
      const prevClient = clients.find((c) => c.id === todayAppts[i - 1].clientId);
      fromLoc = prevClient?.lat != null ? { lat: prevClient.lat, lng: prevClient.lng } : null;
    }
    const client = clients.find((c) => c.id === appt.clientId);
    const destLoc = client?.lat != null ? { lat: client.lat, lng: client.lng } : null;
    if (!fromLoc || !destLoc) continue;

    let travelMin;
    try {
      travelMin = await estimateTravelMinutes(fromLoc, destLoc);
    } catch {
      continue;
    }

    const leaveBy = appt.startMinutes - travelMin - BUFFER_MINUTES;
    if (nowMinutes >= leaveBy) {
      notifiedToday.add(appt.id);
      fireReminder(appt, client, travelMin);
    }
  }
}

function fireReminder(appt, client, travelMin) {
  const message = `Il est temps de partir vers ${appt.clientName} — trajet ≈ ${Math.round(travelMin)} min, RDV à ${fmtMinutesOfDay(appt.startMinutes)}`;
  emit("departure", { appt, client, travelMin, message });
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(`🚗 Départ pour ${appt.clientName}`, { body: message, tag: appt.id });
    } catch {
      // notification indisponible, la bannière dans l'appli suffit
    }
  }
}
