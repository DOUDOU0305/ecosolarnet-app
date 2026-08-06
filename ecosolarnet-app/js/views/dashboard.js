import { Store, getSettings, saveSettings } from "../db.js";
import { escapeHtml, showToast } from "../toast.js";
import { getActiveTimer, startVisit, stopVisit, onTimerEvent, startAutoWatch, stopAutoWatch, formatDuration } from "../timer.js";
import { wazeUrl } from "../geo.js";
import {
  onDepartureEvent,
  startDepartureReminders,
  stopDepartureReminders,
  requestNotificationPermission,
  fmtMinutesOfDay,
} from "../departureReminder.js";
import { getWeatherSummary } from "../weather.js";
import { computeTips } from "../huggyTips.js";

function fmtEuro(n) {
  return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",") + " €";
}

let elapsedIntervalId = null;
let unsubscribeTimer = null;
let unsubscribeDeparture = null;

export async function render(container) {
  if (unsubscribeTimer) {
    unsubscribeTimer();
    unsubscribeTimer = null;
  }
  if (unsubscribeDeparture) {
    unsubscribeDeparture();
    unsubscribeDeparture = null;
  }
  if (elapsedIntervalId) {
    clearInterval(elapsedIntervalId);
    elapsedIntervalId = null;
  }

  const settings = await getSettings();
  const clients = await Store.getAll("clients");
  const devisList = await Store.getAll("devis");
  const entries = await Store.getAll("planningEntries");

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const monthPrefix = todayStr.slice(0, 7);

  const devisCeMois = devisList.filter((d) => (d.date || "").startsWith(monthPrefix));
  const caCeMois = devisCeMois.filter((d) => d.status === "accepte").reduce((s, d) => s + d.total, 0);

  const upcoming = entries
    .filter((e) => e.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  container.innerHTML = `
    <h1>Bonjour 👋</h1>
    <p class="muted" style="margin-top:-10px">${settings.companyName} — ${now.toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long" })}</p>
    <p class="muted" id="weather-line" style="margin-top:2px">🌤️ Chargement de la météo…</p>

    <div id="departure-banner-zone"></div>

    <div class="stat-row">
      <div class="stat-card">
        <div class="num">${clients.length}</div>
        <div class="label">Clients</div>
      </div>
      <div class="stat-card alt">
        <div class="num">${fmtEuro(caCeMois)}</div>
        <div class="label">Devis acceptés ce mois</div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Alertes de départ</h3>
      <p class="muted">Prévient quand il est temps de partir vers le prochain client, en tenant compte du trajet.</p>
      <div class="checkbox-row">
        <input type="checkbox" id="departure-toggle" ${settings.departureRemindersEnabled ? "checked" : ""}>
        <label for="departure-toggle" style="margin:0;font-weight:400;color:var(--text)">Activer les alertes de départ (tant que l'appli reste ouverte)</label>
      </div>
      <p class="muted" id="departure-status" style="margin:6px 0 0"></p>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Chronomètre</h3>
      <div id="timer-zone"></div>
      <div class="checkbox-row" style="margin-top:10px">
        <input type="checkbox" id="auto-timer-toggle" ${settings.autoTimerEnabled ? "checked" : ""}>
        <label for="auto-timer-toggle" style="margin:0;font-weight:400;color:var(--text)">Suivi automatique par GPS (tant que l'appli reste ouverte)</label>
      </div>
      <p class="muted" id="auto-timer-status" style="margin:6px 0 0"></p>
    </div>

    <div class="card">
      <div class="section-title-row">
        <h3 style="margin-top:0">Prochains jours planifiés</h3>
      </div>
      ${upcoming.length === 0 ? `
        <p class="muted">Rien de planifié pour l'instant. Allez dans <strong>Tournées</strong> pour organiser votre mois.</p>
      ` : upcoming.map((e) => `
        <div class="list-item">
          <span>${new Date(e.date).toLocaleDateString("fr-BE", { weekday: "short", day: "numeric", month: "short" })}</span>
          <strong>${escapeHtml(e.label)}</strong>
        </div>
      `).join("")}
    </div>

    <div class="card">
      <h3 style="margin-top:0">🕵️ Les bons tuyaux de Huggy</h3>
      <div id="huggy-tips-zone"><p class="muted">Analyse en cours…</p></div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Actions rapides</h3>
      <button class="btn block" id="qa-client" style="margin-bottom:8px">+ Nouveau client</button>
      <button class="btn secondary block" id="qa-devis" style="margin-bottom:8px">+ Nouveau devis</button>
      <button class="btn secondary block" id="qa-planning">🗺️ Voir les tournées</button>
    </div>
  `;

  container.querySelector("#qa-client").addEventListener("click", () => (location.hash = "#/clients/new"));
  container.querySelector("#qa-devis").addEventListener("click", () => (location.hash = "#/devis/new"));
  container.querySelector("#qa-planning").addEventListener("click", () => (location.hash = "#/planning"));

  await renderTimerZone(container);

  const autoStatus = container.querySelector("#auto-timer-status");
  if (settings.autoTimerEnabled) {
    autoStatus.textContent = "✅ Suivi automatique actif tant que l'appli reste ouverte.";
  }

  container.querySelector("#auto-timer-toggle").addEventListener("change", async (e) => {
    const enabled = e.target.checked;
    await saveSettings({ autoTimerEnabled: enabled });
    if (enabled) {
      autoStatus.textContent = "Activation du GPS…";
      await startAutoWatch();
      autoStatus.textContent = "✅ Suivi automatique actif tant que l'appli reste ouverte.";
    } else {
      stopAutoWatch();
      autoStatus.textContent = "";
    }
  });

  unsubscribeTimer = onTimerEvent((event, data) => {
    if (event === "start" && data.auto) {
      showToast(`Chrono démarré automatiquement : ${data.clientName}`);
      renderTimerZone(container);
    } else if (event === "stop") {
      showToast(
        data.auto
          ? `Chrono arrêté automatiquement — ${formatDuration(data.durationSeconds)} chez ${data.clientName}`
          : `Temps enregistré : ${formatDuration(data.durationSeconds)}`
      );
      renderTimerZone(container);
    } else if (event === "error") {
      showToast(data);
    }
  });

  const departureStatus = container.querySelector("#departure-status");
  if (settings.departureRemindersEnabled) {
    departureStatus.textContent = "✅ Alertes actives tant que l'appli reste ouverte.";
  }

  container.querySelector("#departure-toggle").addEventListener("change", async (e) => {
    const enabled = e.target.checked;
    await saveSettings({ departureRemindersEnabled: enabled });
    if (enabled) {
      await requestNotificationPermission();
      startDepartureReminders();
      departureStatus.textContent = "✅ Alertes actives tant que l'appli reste ouverte.";
    } else {
      stopDepartureReminders();
      departureStatus.textContent = "";
      container.querySelector("#departure-banner-zone").innerHTML = "";
    }
  });

  unsubscribeDeparture = onDepartureEvent((event, data) => {
    if (event !== "departure") return;
    showToast(data.message);
    const banner = container.querySelector("#departure-banner-zone");
    if (!banner) return;
    banner.innerHTML = `
      <div class="card" style="background:var(--sun);border:none">
        <strong>🚗 Il est temps de partir</strong>
        <p style="margin:6px 0">${escapeHtml(data.appt.clientName)} — trajet ≈ ${Math.round(data.travelMin)} min, RDV à ${fmtMinutesOfDay(data.appt.startMinutes)}</p>
        <div class="grid-2">
          <a href="${wazeUrl(data.client || {})}" class="btn secondary block" style="text-decoration:none;text-align:center">🚗 Waze</a>
          <button type="button" class="btn block" id="dismiss-departure-btn">J'ai compris</button>
        </div>
      </div>
    `;
    banner.querySelector("#dismiss-departure-btn").addEventListener("click", () => {
      banner.innerHTML = "";
    });
  });

  const weatherLine = container.querySelector("#weather-line");
  if (settings.baseLat != null && settings.baseLng != null) {
    getWeatherSummary(settings.baseLat, settings.baseLng)
      .then((summary) => {
        if (weatherLine) weatherLine.textContent = `🌤️ ${summary.text}`;
      })
      .catch(() => {
        if (weatherLine) weatherLine.textContent = "🌤️ Météo indisponible pour le moment.";
      });
  } else if (weatherLine) {
    weatherLine.textContent = "🌤️ Renseignez votre adresse dans Réglages pour voir la météo.";
  }

  computeTips()
    .then((tips) => {
      const zone = container.querySelector("#huggy-tips-zone");
      if (!zone) return;
      zone.innerHTML = tips.map((t) => `
        <div class="list-item" style="align-items:flex-start">
          <div>
            <strong>${t.icon} ${escapeHtml(t.title)}</strong>
            <p class="muted" style="margin:4px 0 0">${escapeHtml(t.text)}</p>
          </div>
        </div>
      `).join("");
    })
    .catch(() => {
      const zone = container.querySelector("#huggy-tips-zone");
      if (zone) zone.innerHTML = `<p class="muted">Impossible d'analyser vos données pour le moment.</p>`;
    });
}

async function renderTimerZone(container) {
  const zone = container.querySelector("#timer-zone");
  if (!zone) return;
  const active = await getActiveTimer();

  if (active) {
    zone.innerHTML = `
      <div class="card-row">
        <div>
          <strong>${escapeHtml(active.clientName)}</strong>
          <div class="muted" id="timer-elapsed">00:00:00</div>
        </div>
        <button class="btn danger" id="stop-timer-btn">⏹ Arrêter</button>
      </div>
      ${active.auto ? `<p class="muted" style="margin-top:6px">Démarré automatiquement par le GPS</p>` : ""}
    `;

    const updateElapsed = () => {
      const el = document.getElementById("timer-elapsed");
      if (!el) return;
      const seconds = Math.floor((Date.now() - new Date(active.startTime).getTime()) / 1000);
      el.textContent = formatDuration(seconds);
    };
    updateElapsed();
    if (elapsedIntervalId) clearInterval(elapsedIntervalId);
    elapsedIntervalId = setInterval(updateElapsed, 1000);

    zone.querySelector("#stop-timer-btn").addEventListener("click", async () => {
      clearInterval(elapsedIntervalId);
      elapsedIntervalId = null;
      const visit = await stopVisit();
      if (visit) showToast(`Temps enregistré : ${formatDuration(visit.durationSeconds)}`);
      await renderTimerZone(container);
    });
  } else {
    if (elapsedIntervalId) {
      clearInterval(elapsedIntervalId);
      elapsedIntervalId = null;
    }
    const clients = await Store.getAll("clients");
    clients.sort((a, b) => a.name.localeCompare(b.name));
    zone.innerHTML = `
      <div class="field">
        <select id="timer-client-select">
          <option value="">— Choisir un client —</option>
          ${clients.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
        </select>
      </div>
      <button class="btn block" id="start-timer-btn" ${clients.length === 0 ? "disabled" : ""}>▶ Démarrer</button>
    `;
    zone.querySelector("#start-timer-btn").addEventListener("click", async () => {
      const id = zone.querySelector("#timer-client-select").value;
      const client = clients.find((c) => c.id === id);
      if (!client) {
        showToast("Choisissez un client");
        return;
      }
      await startVisit(client, false);
      await renderTimerZone(container);
    });
  }
}
