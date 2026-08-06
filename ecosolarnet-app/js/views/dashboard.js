import { Store, getSettings, saveSettings } from "../db.js";
import { escapeHtml, showToast } from "../toast.js";
import { getActiveTimer, startVisit, stopVisit, onTimerEvent, startAutoWatch, stopAutoWatch, formatDuration } from "../timer.js";
import { wazeUrl } from "../geo.js";
import { onDepartureEvent, fmtMinutesOfDay } from "../departureReminder.js";
import { getWeatherSummary } from "../weather.js";
import { computeTips } from "../huggyTips.js";
import { speak } from "../huggyVoice.js";
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
  const entries = await Store.getAll("planningEntries");
  const visitTimesAll = await Store.getAll("visitTimes");

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const tomorrowStr = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  function appointmentsForDate(dateStr) {
    const times = visitTimesAll.filter((v) => v.date === dateStr).sort((a, b) => a.startMinutes - b.startMinutes);
    if (times.length > 0) {
      return times.map((t) => ({ time: fmtMinutesOfDay(t.startMinutes), name: t.clientName }));
    }
    const entry = entries.find((e) => e.date === dateStr);
    return entry ? [{ time: "", name: entry.label }] : [];
  }

  const todayAppts = appointmentsForDate(todayStr);
  const tomorrowAppts = appointmentsForDate(tomorrowStr);

  container.innerHTML = `
    <h1>Bonjour 👋</h1>
    <p class="muted" style="margin-top:-10px">${settings.companyName} — ${now.toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long" })}</p>
    <p class="muted" id="weather-line" style="margin-top:2px">🌤️ Chargement de la météo…</p>

    <div id="departure-banner-zone"></div>

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
      <h3 style="margin-top:0">Aujourd'hui</h3>
      ${todayAppts.length === 0 ? `
        <p class="muted">Rien de prévu aujourd'hui.</p>
      ` : todayAppts.map((a) => `
        <div class="list-item">
          <span class="muted" style="min-width:48px">${escapeHtml(a.time)}</span>
          <strong style="flex:1;margin-left:6px">${escapeHtml(a.name)}</strong>
        </div>
      `).join("")}
    </div>

    <div class="card">
      <h3 style="margin-top:0">Demain</h3>
      ${tomorrowAppts.length === 0 ? `
        <p class="muted">Rien de prévu demain.</p>
      ` : tomorrowAppts.map((a) => `
        <div class="list-item">
          <span class="muted" style="min-width:48px">${escapeHtml(a.time)}</span>
          <strong style="flex:1;margin-left:6px">${escapeHtml(a.name)}</strong>
        </div>
      `).join("")}
    </div>

    <div id="huggy-mini" style="display:none;justify-content:space-between;align-items:center;gap:10px;padding:6px 2px 18px">
      <span class="muted">🕵️ Huggy a un tuyau pour vous</span>
      <button type="button" class="btn secondary small" id="huggy-play-btn">▶️ Écouter</button>
    </div>
  `;

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
    .then(async (tips) => {
      const mini = container.querySelector("#huggy-mini");
      if (!mini) return;
      const notifiable = tips.filter((t) => t.notifiable !== false);
      if (notifiable.length === 0) {
        mini.style.display = "none";
        return;
      }
      mini.style.display = "flex";
      const speech = notifiable.map((t) => `${t.title}. ${t.text}`).join(" ... ");

      const notifiedList = await Store.getAll("huggyNotified");
      const notifiedMap = new Map(notifiedList.map((n) => [n.id, n.text]));
      const freshTips = notifiable.filter((t) => notifiedMap.get(t.title) !== t.text);

      if (freshTips.length > 0) {
        for (const t of freshTips) {
          await Store.put("huggyNotified", { id: t.title, text: t.text });
        }
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            const notif = new Notification("🕵️ Huggy a un tuyau pour vous", {
              body: freshTips[0].title,
              tag: "huggy-tip",
            });
            notif.onclick = () => {
              window.focus();
              speak(speech);
            };
          } catch {
            // notification indisponible, le bouton "Écouter" reste disponible
          }
        }
      }

      mini.querySelector("#huggy-play-btn").addEventListener("click", () => speak(speech));
    })
    .catch(() => {});
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
