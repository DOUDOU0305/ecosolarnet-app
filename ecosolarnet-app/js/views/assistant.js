import { Store, uid, getSettings } from "../db.js";
import { escapeHtml, showToast } from "../toast.js";
import { speak, speakAndWait } from "../huggyVoice.js";
import { geocodeAddress, fullAddress, computeRouteKm, haversineKm } from "../geo.js";
import { getActiveTimer, startVisit, stopVisit, formatDuration } from "../timer.js";
import { computeBriefing, briefingSpokenText } from "./dashboard.js";
import { FUNCTIONS_BASE } from "../config.js";

const ARRIVE_RADIUS_M = 150; // un peu plus large que le suivi GPS auto, puisque c'est une confirmation vocale explicite de l'utilisateur, pas une détection automatique.

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("GPS indisponible"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  });
}

async function findNearbyClient() {
  const here = await getCurrentPosition();
  const clients = await Store.getAll("clients");
  let closest = null;
  let closestDist = Infinity;
  for (const c of clients.filter((c) => c.lat != null)) {
    const d = haversineKm(here, { lat: c.lat, lng: c.lng }) * 1000;
    if (d < closestDist) {
      closestDist = d;
      closest = c;
    }
  }
  return closest && closestDist <= ARRIVE_RADIUS_M ? closest : null;
}

let log = [];
let busy = false;
let correctingId = null;
let handsFreeActive = false;
let handsFreeStatus = "";
// Bumped on every render() call so a hands-free loop started on a previous
// visit to this view can tell it's no longer current (the user navigated
// away) and stop — otherwise it would keep calling paint() on the #view
// element after app.js has replaced its content with a different screen.
let renderToken = 0;

function isNative() {
  return typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();
}

function speechPlugin() {
  // Set by js/vendor/native-plugins.bundle.js — see huggyVoice.js's
  // nativePlugin() for why this is a prebuilt bundle instead of an npm import.
  return window.NativeSpeechRecognition || null;
}

export async function render(container) {
  renderToken++;
  paint(container);
}

// Called by app.js right before it renders a different route, so the mic
// doesn't keep listening (and the native permission indicator doesn't stay
// on) after the user has left this screen.
export function cleanupHandsFree() {
  if (!handsFreeActive) return;
  handsFreeActive = false;
  speechPlugin()?.stop().catch(() => {});
}

function paint(container) {
  const canHandsFree = isNative() && !!speechPlugin();
  container.innerHTML = `
    <h1>Assistant</h1>
    <p class="muted" style="margin-top:-10px">Dictez une demande, l'IA s'en occupe</p>

    ${canHandsFree ? `
      <div class="card" style="text-align:center">
        <button type="button" class="btn ${handsFreeActive ? "danger" : ""} block" id="hands-free-btn">
          ${handsFreeActive ? "⏹ Arrêter le mode mains-libres" : "🚗 Activer le mode mains-libres"}
        </button>
        ${handsFreeStatus ? `<p class="muted" style="margin:8px 0 0">${escapeHtml(handsFreeStatus)}</p>` : `<p class="muted" style="margin:8px 0 0">Idéal au volant : un seul appui, puis parlez librement — l'assistant répond à voix haute et se remet à écouter tout seul.</p>`}
      </div>
    ` : ""}

    <div class="card">
      <p class="muted" style="margin-top:0">Touchez le champ, utilisez le micro 🎤 de votre clavier pour dicter, puis touchez "Envoyer".</p>
      <textarea id="assistant-input" rows="3" placeholder="Ex : Ajoute un client Jean Dupont, rue de la Gare 5 à Gerpinnes, téléphone 0470 12 34 56"></textarea>
      <button type="button" class="btn block" id="assistant-send-btn" ${busy ? "disabled" : ""}>${busy ? "…" : "🎤 Envoyer"}</button>
    </div>

    <div id="assistant-log">
      ${log.length === 0 ? `
        <div class="empty-state">
          <div class="big">🎙️</div>
          <p>Essayez : "Ajoute un client...", "Mets [nom] au planning le 14 août à 10h30", "Fais-moi un rappel de...", "Je viens d'avoir une idée, prends note...", ou posez une question.</p>
        </div>
      ` : log.slice().reverse().map((entry) => `
        <div class="card" style="background:${entry.role === "user" ? "var(--fill)" : "var(--teal-light)"}">
          <span class="muted" style="font-size:11px;font-weight:600;letter-spacing:0.3px">${entry.role === "user" ? "VOUS" : "ASSISTANT"}</span>
          <p style="margin:4px 0 0;white-space:pre-wrap">${escapeHtml(entry.text)}</p>
          ${entry.role === "assistant" && !entry.isCorrection ? `
            ${correctingId === entry.id ? `
              <div style="margin-top:10px">
                <input type="text" id="correction-input-${entry.id}" placeholder="Qu'est-ce que vous vouliez dire ?" style="width:100%">
                <div style="display:flex;gap:8px;margin-top:8px">
                  <button type="button" class="btn small block correction-save-btn" data-id="${entry.id}">Enregistrer</button>
                  <button type="button" class="btn secondary small block correction-cancel-btn" data-id="${entry.id}">Annuler</button>
                </div>
              </div>
            ` : `
              <button type="button" class="btn secondary small correction-open-btn" data-id="${entry.id}" style="margin-top:8px">❌ Ce n'est pas ça</button>
            `}
          ` : ""}
        </div>
      `).join("")}
    </div>
  `;

  container.querySelector("#assistant-send-btn").addEventListener("click", () => handleManualSend(container));
  container.querySelector("#assistant-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleManualSend(container);
    }
  });

  const handsFreeBtn = container.querySelector("#hands-free-btn");
  if (handsFreeBtn) {
    handsFreeBtn.addEventListener("click", () => {
      if (handsFreeActive) stopHandsFree(container);
      else startHandsFree(container);
    });
  }

  container.querySelectorAll(".correction-open-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      correctingId = btn.dataset.id;
      paint(container);
      container.querySelector(`#correction-input-${correctingId}`)?.focus();
    });
  });
  container.querySelectorAll(".correction-cancel-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      correctingId = null;
      paint(container);
    });
  });
  container.querySelectorAll(".correction-save-btn").forEach((btn) => {
    btn.addEventListener("click", () => saveCorrection(container, btn.dataset.id));
  });
}

async function saveCorrection(container, entryId) {
  const input = container.querySelector(`#correction-input-${entryId}`);
  const correctionText = input?.value.trim();
  if (!correctionText) {
    showToast("Écrivez ce que vous vouliez dire");
    return;
  }
  const entryIndex = log.findIndex((e) => e.id === entryId);
  const assistantEntry = log[entryIndex];
  const userEntry = entryIndex > 0 ? log[entryIndex - 1] : null;

  await Store.put("assistantCorrections", {
    originalMessage: userEntry?.text || "",
    wrongReply: assistantEntry?.text || "",
    correction: correctionText,
    createdAt: Date.now(),
  });

  correctingId = null;
  log.push({ id: uid(), role: "assistant", text: "Merci, c'est noté pour la prochaine fois.", isCorrection: true });
  showToast("Correction enregistrée");
  paint(container);
}

function parseHM(str) {
  const [h, m] = String(str).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

async function scheduleClientOnDate(client, dateStr, startMinutes, durationMinutes) {
  const existingEntries = await Store.getAll("planningEntries");
  const currentEntry = existingEntries.find((p) => p.date === dateStr);
  if (currentEntry && !currentEntry.tourneeId && currentEntry.label) {
    return { blocked: true, label: currentEntry.label };
  }
  const tournee = currentEntry?.tourneeId ? await Store.get("tournees", currentEntry.tourneeId) : null;

  const clientIds = tournee ? [...tournee.clientIds] : [];
  const clientNames = tournee ? [...tournee.clientNames] : [];
  if (!clientIds.includes(client.id)) {
    clientIds.push(client.id);
    clientNames.push(client.name);
  }

  await Store.put("visitTimes", {
    id: `${dateStr}_${client.id}`,
    date: dateStr,
    clientId: client.id,
    clientName: client.name,
    startMinutes,
    durationMinutes,
  });

  const [settings, allClients, allTimes] = await Promise.all([
    getSettings(),
    Store.getAll("clients"),
    Store.getAll("visitTimes"),
  ]);
  const base = settings.baseLat != null ? { lat: settings.baseLat, lng: settings.baseLng } : null;
  const timesForDay = new Map(allTimes.filter((v) => v.date === dateStr).map((v) => [v.clientId, v]));
  const ordered = clientIds
    .map((id) => {
      const c = allClients.find((cl) => cl.id === id);
      if (!c) return null;
      return { lat: c.lat, lng: c.lng, startMinutes: timesForDay.get(id)?.startMinutes ?? 0 };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinutes - b.startMinutes);

  const saved = await Store.put("tournees", {
    id: tournee?.id,
    name: `Jour du ${dateStr}`,
    clientIds,
    clientNames,
    km: computeRouteKm(ordered, base),
  });

  await Store.put("planningEntries", { id: currentEntry?.id, date: dateStr, tourneeId: saved.id, label: saved.name });
  return { blocked: false };
}

// Cœur partagé entre l'envoi manuel (textarea) et la boucle mains-libres :
// interprète un message, applique l'action correspondante, journalise, et
// renvoie le texte de la réponse (à afficher et/ou à faire parler).
async function processMessage(message) {
  const settings = await getSettings();
  const allClients = await Store.getAll("clients");
  const recentCorrections = (await Store.getAll("assistantCorrections"))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 8)
    .map((c) => ({ originalMessage: c.originalMessage, wrongReply: c.wrongReply, correction: c.correction }));

  const res = await fetch(`${FUNCTIONS_BASE}/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      clients: allClients.map((c) => ({ id: c.id, name: c.name })),
      todayDate: new Date().toISOString().slice(0, 10),
      companyName: settings.companyName,
      recentCorrections,
    }),
  });
  if (!res.ok) throw new Error(`Assistant indisponible (${res.status})`);
  const data = await res.json();

  let finalReply = data.reply;

  if (data.intent === "add_client" && data.client?.name) {
    const record = await Store.put("clients", {
      name: data.client.name,
      address: data.client.address || "",
      postalCode: data.client.postalCode || "",
      city: data.client.city || "",
      phone: data.client.phone || "",
      email: "",
      serviceTypes: ["vitres"],
      frequency: "ponctuel",
      notes: "",
      lat: null,
      lng: null,
    });
    if (record.address) {
      geocodeAddress(fullAddress(record))
        .then((coords) => {
          if (coords) Store.put("clients", { ...record, lat: coords.lat, lng: coords.lng });
        })
        .catch(() => {});
    }
  } else if (data.intent === "add_reminder" && data.reminderText) {
    await Store.put("reminders", { text: data.reminderText, done: false, createdAt: Date.now() });
  } else if (data.intent === "add_idea" && data.ideaText) {
    // "Idées" a été fusionné dans "Rappels" (2026-08-19) — une idée dictée
    // devient simplement un rappel de plus.
    await Store.put("reminders", { text: data.ideaText, done: false, createdAt: Date.now() });
  } else if (data.intent === "start_timer") {
    const active = await getActiveTimer();
    if (active) {
      finalReply = `Le chrono tourne déjà, chez ${active.clientName}.`;
    } else {
      try {
        const client = await findNearbyClient();
        if (client) {
          await startVisit(client, false);
          finalReply = `Chrono démarré chez ${client.name}.`;
        } else {
          finalReply = "Je ne trouve pas de client à proximité pour démarrer le chrono. Vous pouvez le démarrer à la main depuis l'écran d'accueil.";
        }
      } catch {
        finalReply = "Impossible d'accéder à votre position pour démarrer le chrono. Vérifiez que la localisation est autorisée.";
      }
    }
  } else if (data.intent === "stop_timer") {
    const active = await getActiveTimer();
    if (!active) {
      finalReply = "Aucun chrono en cours.";
    } else {
      const visit = await stopVisit();
      finalReply = `Chrono arrêté — ${formatDuration(visit.durationSeconds)} chez ${visit.clientName}.`;
    }
  } else if (data.intent === "schedule_appointment" && data.appointment?.clientName && data.appointment?.date) {
    const spoken = data.appointment.clientName.toLowerCase();
    const matched = allClients.find((c) => c.name.toLowerCase() === spoken)
      || allClients.find((c) => c.name.toLowerCase().includes(spoken) || spoken.includes(c.name.toLowerCase()));
    if (matched) {
      const visits = await Store.getAll("visits");
      const clientVisits = visits.filter((v) => v.clientId === matched.id);
      const avgMin = clientVisits.length > 0
        ? Math.round(clientVisits.reduce((s, v) => s + v.durationSeconds, 0) / clientVisits.length / 60)
        : 60;
      const startMinutes = data.appointment.time ? parseHM(data.appointment.time) : 8 * 60;
      const result = await scheduleClientOnDate(matched, data.appointment.date, startMinutes, Math.max(15, avgMin));
      if (result.blocked) {
        finalReply = `Impossible : le ${data.appointment.date} est bloqué (${result.label}), aucun client ne peut y être ajouté.`;
      }
    } else {
      finalReply = `Je n'ai pas trouvé de client nommé "${data.appointment.clientName}" — ajoutez-le d'abord.`;
    }
  }

  return finalReply;
}

async function handleManualSend(container) {
  if (busy) return;
  const textarea = container.querySelector("#assistant-input");
  const message = textarea.value.trim();
  if (!message) return;

  busy = true;
  log.push({ id: uid(), role: "user", text: message });
  paint(container);

  try {
    const finalReply = await processMessage(message);
    log.push({ id: uid(), role: "assistant", text: finalReply });
    speak(finalReply);
  } catch (err) {
    const errText = "Erreur : " + (err.message || err);
    log.push({ id: uid(), role: "assistant", text: errText, isCorrection: true });
    showToast(errText);
  } finally {
    busy = false;
    paint(container);
    const freshTextarea = container.querySelector("#assistant-input");
    if (freshTextarea) freshTextarea.value = "";
  }
}

function setHandsFreeStatus(container, status) {
  handsFreeStatus = status;
  const p = container.querySelector("#hands-free-btn")?.nextElementSibling;
  if (p) p.textContent = status;
}

async function startHandsFree(container) {
  const plugin = speechPlugin();
  if (!plugin) return;

  try {
    const perm = await plugin.checkPermissions();
    if (perm.speechRecognition !== "granted") {
      const req = await plugin.requestPermissions();
      if (req.speechRecognition !== "granted") {
        showToast("Micro/reconnaissance vocale refusés dans les Réglages iPhone");
        return;
      }
    }
  } catch {
    showToast("Reconnaissance vocale indisponible sur cet appareil");
    return;
  }

  const myToken = renderToken;
  handsFreeActive = true;
  paint(container);
  const briefing = await computeBriefing().catch(() => null);
  const briefingText = briefing ? briefingSpokenText(briefing) : "";
  await speakAndWait(`Mode mains-libres activé. ${briefingText} Je vous écoute.`);
  if (myToken !== renderToken) return; // l'utilisateur a déjà changé d'écran
  handsFreeLoop(container, myToken);
}

function stopHandsFree(container) {
  handsFreeActive = false;
  speechPlugin()?.stop().catch(() => {});
  handsFreeStatus = "";
  paint(container);
}

async function handsFreeLoop(container, myToken) {
  while (handsFreeActive && myToken === renderToken) {
    setHandsFreeStatus(container, "🎙️ Je vous écoute…");
    let heard = "";
    try {
      const result = await speechPlugin().start({ language: "fr-FR", maxResults: 1, partialResults: false });
      heard = (result.matches || [])[0] || "";
    } catch {
      // Souvent un simple timeout de silence : on relance l'écoute sans
      // interrompre le mode mains-libres.
      continue;
    }
    if (!handsFreeActive || myToken !== renderToken) break;
    if (!heard) continue;

    log.push({ id: uid(), role: "user", text: heard });
    setHandsFreeStatus(container, "🤔 Je réfléchis…");
    paint(container);

    let reply;
    try {
      reply = await processMessage(heard);
    } catch (err) {
      reply = "Erreur : " + (err.message || err);
    }
    log.push({ id: uid(), role: "assistant", text: reply });
    if (myToken !== renderToken) break;
    paint(container);

    if (!handsFreeActive || myToken !== renderToken) break;
    setHandsFreeStatus(container, "🔊 Réponse en cours…");
    await speakAndWait(reply);
  }
  if (myToken === renderToken) {
    handsFreeStatus = "";
    paint(container);
  }
}
