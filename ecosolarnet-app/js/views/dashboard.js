import { Store, getSettings, saveSettings } from "../db.js";
import { escapeHtml, showToast } from "../toast.js";
import { getActiveTimer, startVisit, stopVisit, onTimerEvent, startAutoWatch, stopAutoWatch, formatDuration } from "../timer.js";
import { wazeUrl } from "../geo.js";
import { onDepartureEvent, fmtMinutesOfDay } from "../departureReminder.js";
import { getWeatherSummary } from "../weather.js";
import { computeTips } from "../huggyTips.js";
import { speak } from "../huggyVoice.js";
import { generateQrDataUrl } from "../qrcode.js";
import { buildEpcQrPayload } from "../paymentQr.js";
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
      return times.map((t) => ({ time: fmtMinutesOfDay(t.startMinutes), name: t.clientName, clientId: t.clientId, client: clients.find((c) => c.id === t.clientId) || null }));
    }
    const entry = entries.find((e) => e.date === dateStr);
    return entry ? [{ time: "", name: entry.label, clientId: null, client: null }] : [];
  }

  const todayAppts = appointmentsForDate(todayStr);
  const tomorrowAppts = appointmentsForDate(tomorrowStr);

  container.innerHTML = `
    <h1>Bonjour 👋</h1>
    <p class="muted" style="margin-top:-10px">${settings.companyName} — ${now.toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long" })}</p>
    <p class="muted" id="weather-line" style="margin-top:2px">🌤️ Chargement de la météo…</p>

    <div id="departure-banner-zone"></div>

    <div class="card">
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

    ${settings.iban || settings.googleReviewUrl ? `
      <div class="card">
        <h3 style="margin-top:0">Codes QR pour le client</h3>
        ${settings.iban ? `
          <div class="field">
            <label>Montant à payer (€)</label>
            <input type="number" step="0.01" min="0" id="qr-amount-input" placeholder="Ex : 120">
          </div>
          <div style="text-align:center;margin-bottom:6px">
            <div id="pay-qr-preview" style="display:inline-block;padding:8px;background:white;border-radius:10px;border:1px solid var(--border)"></div>
            <p class="muted" style="margin:6px 0 0">💳 Payer par QR code</p>
            <p class="muted" style="margin:2px 0 0;font-size:11.5px">À scanner depuis l'appli bancaire du client (pas l'appareil photo)</p>
          </div>
          <div class="card-row" style="background:var(--fill);border-radius:var(--radius-sm);padding:9px 12px;margin-bottom:14px">
            <span class="muted" style="font-size:13px">IBAN : ${escapeHtml(settings.iban)}</span>
            <button type="button" class="btn secondary small" id="copy-iban-btn">Copier</button>
          </div>
        ` : ""}
        ${settings.googleReviewUrl ? `
          <div style="text-align:center">
            <div id="review-qr-preview" style="display:inline-block;padding:8px;background:white;border-radius:10px;border:1px solid var(--border)"></div>
            <p class="muted" style="margin:6px 0 0">⭐ Laisser un avis Google</p>
          </div>
        ` : ""}
      </div>
    ` : ""}

    <div class="card">
      <div class="card-row" style="margin-bottom:8px">
        <h3 style="margin:0">Chronomètre</h3>
        <button type="button" class="btn secondary small" id="auto-timer-toggle-btn">📍 GPS ${settings.autoTimerEnabled ? "activé" : "désactivé"}</button>
      </div>
      <div id="timer-zone"></div>
    </div>

    <div id="huggy-mini" style="display:none;justify-content:space-between;align-items:center;gap:10px;padding:6px 2px 18px">
      <span class="muted">🕵️ Huggy a un tuyau pour vous</span>
      <button type="button" class="btn secondary small" id="huggy-play-btn">▶️ Écouter</button>
    </div>
  `;

  await renderTimerZone(container);
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
      await renderTimerZone(container);
      await updateTodayTimerButtons(container);
    });
  });

  async function renderPayQr(amount) {
    const preview = container.querySelector("#pay-qr-preview");
    if (!preview) return;
    try {
      const payload = buildEpcQrPayload({
        bic: settings.bic,
        name: settings.companyName,
        iban: settings.iban,
        amount: amount || 0,
        remittance: `Paiement ${settings.companyName}`,
      });
      const dataUrl = await generateQrDataUrl(payload, 260);
      preview.innerHTML = `<img src="${dataUrl}" alt="QR de paiement" style="width:130px;height:130px;display:block">`;
    } catch {
      preview.innerHTML = `<p class="muted" style="margin:0">QR indisponible</p>`;
    }
  }

  if (settings.iban) {
    renderPayQr(0);
    let qrDebounce;
    container.querySelector("#qr-amount-input").addEventListener("input", (e) => {
      clearTimeout(qrDebounce);
      const val = parseFloat(e.target.value) || 0;
      qrDebounce = setTimeout(() => renderPayQr(val), 300);
    });
    container.querySelector("#copy-iban-btn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(settings.iban.replace(/\s+/g, ""));
        showToast("IBAN copié");
      } catch {
        showToast("Impossible de copier — sélectionnez le texte manuellement");
      }
    });
  }

  if (settings.googleReviewUrl) {
    generateQrDataUrl(settings.googleReviewUrl, 260)
      .then((dataUrl) => {
        const preview = container.querySelector("#review-qr-preview");
        if (preview) preview.innerHTML = `<img src="${dataUrl}" alt="QR avis Google" style="width:130px;height:130px;display:block">`;
      })
      .catch(() => {});
  }

  const autoToggleBtn = container.querySelector("#auto-timer-toggle-btn");
  autoToggleBtn.addEventListener("click", async () => {
    const enabled = !settings.autoTimerEnabled;
    settings.autoTimerEnabled = enabled;
    await saveSettings({ autoTimerEnabled: enabled });
    if (enabled) {
      autoToggleBtn.textContent = "📍 GPS activation…";
      await startAutoWatch();
      showToast("Suivi GPS automatique activé");
    } else {
      stopAutoWatch();
      showToast("Suivi GPS automatique désactivé");
    }
    autoToggleBtn.textContent = `📍 GPS ${enabled ? "activé" : "désactivé"}`;
  });

  unsubscribeTimer = onTimerEvent((event, data) => {
    if (event === "start" && data.auto) {
      showToast(`Chrono démarré automatiquement : ${data.clientName}`);
      renderTimerZone(container);
      updateTodayTimerButtons(container);
    } else if (event === "stop") {
      showToast(
        data.auto
          ? `Chrono arrêté automatiquement — ${formatDuration(data.durationSeconds)} chez ${data.clientName}`
          : `Temps enregistré : ${formatDuration(data.durationSeconds)}`
      );
      renderTimerZone(container);
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
      <div style="display:flex;gap:8px;align-items:flex-start">
        <select id="timer-client-select" style="flex:1;margin-bottom:0">
          <option value="">— Choisir un client —</option>
          ${clients.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
        </select>
        <button class="btn" id="start-timer-btn" style="white-space:nowrap" ${clients.length === 0 ? "disabled" : ""}>▶ Démarrer</button>
      </div>
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
