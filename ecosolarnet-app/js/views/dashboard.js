import { Store, getSettings } from "../db.js";
import { escapeHtml, showToast } from "../toast.js";
import { getActiveTimer, startVisit, stopVisit, onTimerEvent, formatDuration } from "../timer.js";
import { wazeUrl } from "../geo.js";
import { onDepartureEvent, fmtMinutesOfDay } from "../departureReminder.js";
import { getWeatherSummary } from "../weather.js";
import { computeTips } from "../huggyTips.js";
import { speak } from "../huggyVoice.js";
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
      return times.map((t) => ({ time: fmtMinutesOfDay(t.startMinutes), name: t.clientName, clientId: t.clientId, client: clients.find((c) => c.id === t.clientId) || null }));
    }
    const entry = entries.find((e) => e.date === dateStr);
    return entry ? [{ time: "", name: entry.label, clientId: null, client: null }] : [];
  }

  const todayAppts = appointmentsForDate(todayStr);
  const tomorrowAppts = appointmentsForDate(tomorrowStr);

  container.innerHTML = `
    <h1 style="margin-bottom:6px">Bonjour 👋</h1>
    <p class="muted" style="margin:0 0 2px">${settings.companyName} — ${now.toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long" })}</p>
    <p class="muted" id="weather-line" style="margin:0 0 28px">🌤️ Chargement de la météo…</p>

    <div id="departure-banner-zone"></div>

    <div class="card" style="margin-bottom:24px">
      <h3 style="margin-top:0">Aujourd'hui</h3>
      ${todayAppts.length === 0 ? `
        <p class="muted">Rien de prévu aujourd'hui.</p>
      ` : todayAppts.map((a, i) => `
        <div class="list-item">
          <span class="muted" style="min-width:48px">${escapeHtml(a.time)}</span>
          <strong style="flex:1;margin-left:6px">${escapeHtml(a.name)}</strong>
          ${a.client ? `<a href="${wazeUrl(a.client)}" style="text-decoration:none;font-size:19px;padding:4px 2px;line-height:1">🚗</a>` : ""}
          ${a.clientId ? `<button type="button" class="today-timer-btn" data-client-id="${a.clientId}" data-client-name="${escapeHtml(a.name)}" style="background:none;border:none;font-size:19px;padding:4px 2px;line-height:1;font-family:inherit">⏱️</button>` : ""}
        </div>
      `).join("")}
    </div>

    <div class="card" style="margin-bottom:24px">
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

    <div id="huggy-mini" style="display:none;justify-content:space-between;align-items:center;gap:10px;padding:2px 2px 0">
      <span class="muted">🕵️ Huggy a un tuyau pour vous</span>
      <button type="button" class="btn secondary small" id="huggy-play-btn">▶️ Écouter</button>
    </div>
  `;

  await updateTodayTimerButtons(container);

  container.querySelectorAll(".today-timer-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const clientId = btn.dataset.clientId;
      const clientName = btn.dataset.clientName;
      const active = await getActiveTimer();

      if (active && active.clientId === clientId) {
        const visit = await stopVisit();
        if (visit) showToast(`Temps enregistré : ${formatDuration(visit.durationSeconds)}`);
      } else if (active) {
        showToast(`Arrêtez d'abord le chrono en cours (${active.clientName})`);
        return;
      } else {
        await startVisit({ id: clientId, name: clientName }, false);
      }
      await updateTodayTimerButtons(container);
    });
  });

  unsubscribeTimer = onTimerEvent((event, data) => {
    if (event === "start" && data.auto) {
      showToast(`Chrono démarré automatiquement : ${data.clientName}`);
      updateTodayTimerButtons(container);
    } else if (event === "stop") {
      showToast(
        data.auto
          ? `Chrono arrêté automatiquement — ${formatDuration(data.durationSeconds)} chez ${data.clientName}`
          : `Temps enregistré : ${formatDuration(data.durationSeconds)}`
      );
      updateTodayTimerButtons(container);
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

async function updateTodayTimerButtons(container) {
  const active = await getActiveTimer();
  container.querySelectorAll(".today-timer-btn").forEach((btn) => {
    const isActive = active && active.clientId === btn.dataset.clientId;
    btn.textContent = isActive ? "⏹️" : "⏱️";
  });
}
