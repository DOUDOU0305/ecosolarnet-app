import { Store, getSettings } from "../db.js";
import { showToast, escapeHtml } from "../toast.js";
import { wazeUrl, computeRouteKm } from "../geo.js";
import { monthLabel } from "../scheduling.js";

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DAY_START = 0; // minuit
const DAY_END = 24 * 60; // minuit le lendemain
const SCROLL_TO_HOUR = 7; // défilement automatique vers cette heure à l'ouverture
const PX_PER_MIN = 1.2;
const LONG_PRESS_COPY_MS = 480;
const CLIPBOARD_KEY = "ecosolarnet-clipboard-appt";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtHM(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

// Format affiché à l'utilisateur (09H30) — différent de fmtHM() qui reste au
// format HH:MM exigé par les <input type="time"> natifs.
function fmtHMDisplay(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${pad2(h)}H${pad2(m)}`;
}

function parseHM(str) {
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
}

// renderDay()/renderMonth() sont appelées à répétition sur le même élément
// #view persistant (l'appli ne recrée pas ce noeud à chaque navigation). Sans
// nettoyage, chaque visite empilerait un nouveau jeu d'écouteurs de balayage
// par-dessus les précédents (y compris ceux d'une autre vue, ex. le balayage
// vertical du mois resterait actif sur la page jour) : un seul geste finissait
// par déclencher plusieurs navigations à la fois, d'où l'écran vide et le
// changement de mois inattendu. On annule donc systématiquement les écouteurs
// de la vue précédente avant d'attacher les nouveaux.
let swipeController = null;

// Appelé par app.js à chaque changement d'onglet, pour retirer les écouteurs
// de balayage même quand on quitte le calendrier sans repasser par une vue
// jour/mois (sinon ils resteraient actifs par-dessus les autres pages).
export function cleanupSwipe(container) {
  if (swipeController) {
    swipeController.abort();
    swipeController = null;
  }
  if (container) container.style.touchAction = "";
}

function resetSwipe(container) {
  if (swipeController) swipeController.abort();
  swipeController = new AbortController();
  container.style.touchAction = "";
  return swipeController.signal;
}

// Balayage horizontal (vue jour) : bascule sur le jour précédent/suivant.
// Ignore les gestes qui démarrent sur un rendez-vous (.appt-block) pour ne pas
// entrer en conflit avec le glisser-déposer d'horaire, ni sur un contrôle
// interactif (bouton, champ...).
function wireHorizontalSwipe(container, onSwipe) {
  const signal = resetSwipe(container);
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let axis = null;
  const THRESHOLD = 60;

  container.style.touchAction = "pan-y";

  container.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".appt-block, button, a, input, select, textarea")) return;
    startX = e.clientX;
    startY = e.clientY;
    dragging = true;
    axis = null;
  }, { signal });
  container.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (axis === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
  }, { signal });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    if (axis !== "x") return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) >= THRESHOLD) onSwipe(dx < 0 ? 1 : -1);
  }
  container.addEventListener("pointerup", endDrag, { signal });
  container.addEventListener("pointercancel", endDrag, { signal });
}

// Balayage vertical (vue mois, comme dans Calendrier d'Apple) : bascule sur le
// mois précédent/suivant. Un tap normal sur un jour (peu de mouvement) continue
// de fonctionner via son propre gestionnaire de clic.
function wireVerticalSwipe(container, onSwipe) {
  const signal = resetSwipe(container);
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let axis = null;
  const THRESHOLD = 60;

  container.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, a, input, select, textarea")) return;
    startX = e.clientX;
    startY = e.clientY;
    dragging = true;
    axis = null;
  }, { signal });
  container.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (axis === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
  }, { signal });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    if (axis !== "y") return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) >= THRESHOLD) onSwipe(dy < 0 ? 1 : -1);
  }
  container.addEventListener("pointerup", endDrag, { signal });
  container.addEventListener("pointercancel", endDrag, { signal });
}

// --- Vue Année ---

export async function renderYear(container, year) {
  const entries = await Store.getAll("planningEntries");
  const countByMonth = {};
  for (const e of entries) {
    const key = e.date.slice(0, 7);
    if (key.startsWith(String(year))) countByMonth[key] = (countByMonth[key] || 0) + 1;
  }

  container.innerHTML = `
    <div class="card-row" style="margin-bottom:10px">
      <button class="btn secondary small" id="prev-year">‹</button>
      <h1 style="margin:0">${year}</h1>
      <button class="btn secondary small" id="next-year">›</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${MONTHS.map((name, i) => {
        const monthStr = `${year}-${pad2(i + 1)}`;
        const count = countByMonth[monthStr] || 0;
        const isCurrent = monthStr === todayStr().slice(0, 7);
        return `
          <button type="button" class="card mini-month${isCurrent ? " mini-month-current" : ""}" data-month="${monthStr}" style="text-align:left;font-family:inherit;cursor:pointer">
            <strong>${name}</strong>
            ${count > 0 ? `<div class="pill" style="margin-top:6px">${count} jour${count > 1 ? "s" : ""} planifié${count > 1 ? "s" : ""}</div>` : `<div class="muted" style="margin-top:6px;font-size:12px">—</div>`}
          </button>
        `;
      }).join("")}
    </div>
  `;

  container.querySelector("#prev-year").addEventListener("click", () => {
    location.hash = `#/planning/year-${year - 1}`;
  });
  container.querySelector("#next-year").addEventListener("click", () => {
    location.hash = `#/planning/year-${year + 1}`;
  });
  container.querySelectorAll("[data-month]").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = `#/planning/month-${btn.dataset.month}`;
    });
  });
}

// --- Vue Mois ---

export async function renderMonth(container, monthStr) {
  const [year, month] = monthStr.split("-").map(Number);
  const settings = await getSettings();
  const defenseCodes = settings.defenseDayCodes || [];
  const entries = await Store.getAll("planningEntries");
  const entryByDate = new Map(entries.map((e) => [e.date, e]));

  const firstDay = new Date(year, month - 1, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = todayStr();

  let cells = "";
  for (let i = 0; i < startOffset; i++) cells += `<div></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad2(month)}-${pad2(d)}`;
    const entry = entryByDate.get(dateStr);
    const isDefense = entry && !entry.tourneeId && defenseCodes.includes(entry.label);
    const isToday = dateStr === today;
    cells += `
      <button type="button" class="cal-day-btn${isToday ? " cal-today" : ""}" data-date="${dateStr}"
        style="aspect-ratio:1;border:1px solid ${isToday ? "var(--danger)" : "var(--border)"};border-radius:8px;background:${isDefense ? "rgba(201,151,79,0.16)" : entry ? "var(--teal-light)" : "white"};font-family:inherit;font-size:13px;padding:2px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;cursor:pointer">
        <span style="${isToday ? "background:var(--danger);color:white;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-weight:700" : "font-weight:400"}">${d}</span>
        ${isDefense ? `<span style="font-size:9px;color:var(--sun-text);font-weight:600">${escapeHtml(entry.label)}</span>` : entry ? `<span style="width:5px;height:5px;border-radius:50%;background:var(--teal-dark)"></span>` : ""}
      </button>
    `;
  }

  container.innerHTML = `
    <button class="back-btn" id="back-to-year">‹ ${year}</button>
    <div class="card-row" style="margin-bottom:10px">
      <button class="btn secondary small" id="prev-month">‹</button>
      <h1 style="margin:0;text-transform:capitalize">${MONTHS[month - 1]} ${year}</h1>
      <button class="btn secondary small" id="next-month">›</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px">
      ${WEEKDAYS.map((w) => `<div style="text-align:center;font-size:10px;color:var(--text-muted)">${w}</div>`).join("")}
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">${cells}</div>
  `;

  container.querySelector("#back-to-year").addEventListener("click", () => {
    location.hash = `#/planning/year-${year}`;
  });
  function adjacentMonth(delta) {
    let y = year;
    let m = month + delta;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    return `${y}-${pad2(m)}`;
  }
  container.querySelector("#prev-month").addEventListener("click", () => {
    location.hash = `#/planning/month-${adjacentMonth(-1)}`;
  });
  container.querySelector("#next-month").addEventListener("click", () => {
    location.hash = `#/planning/month-${adjacentMonth(1)}`;
  });
  container.querySelectorAll("[data-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = `#/planning/day-${btn.dataset.date}`;
    });
  });

  // Balayage vers le haut = mois suivant, vers le bas = mois précédent (façon Apple Calendrier).
  wireVerticalSwipe(container, (dir) => {
    location.hash = `#/planning/month-${adjacentMonth(dir)}`;
  });
}

// Calcule une disposition côte à côte pour les rendez-vous qui se chevauchent
// dans le temps (comme dans Apple Calendar), plutôt que de les superposer.
function layoutOverlaps(clients) {
  const items = clients.map((c, i) => ({
    idx: i,
    start: c.startMinutes,
    end: c.startMinutes + c.durationMinutes,
  }));
  items.sort((a, b) => a.start - b.start);

  const clusters = [];
  let currentCluster = [];
  let clusterEnd = -Infinity;
  for (const item of items) {
    if (currentCluster.length > 0 && item.start >= clusterEnd) {
      clusters.push(currentCluster);
      currentCluster = [];
      clusterEnd = -Infinity;
    }
    currentCluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  const layout = {};
  for (const cluster of clusters) {
    const columnEnds = [];
    for (const item of cluster) {
      let colIndex = columnEnds.findIndex((end) => end <= item.start);
      if (colIndex === -1) {
        colIndex = columnEnds.length;
        columnEnds.push(item.end);
      } else {
        columnEnds[colIndex] = item.end;
      }
      layout[item.idx] = { col: colIndex };
    }
    const numCols = columnEnds.length;
    for (const item of cluster) layout[item.idx].numCols = numCols;
  }
  return layout;
}

// --- Vue Jour (chronologie horaire, glisser-déposer) ---

export async function renderDay(container, dateStr) {
  const settings = await getSettings();
  const allClients = await Store.getAll("clients");
  const visits = await Store.getAll("visits");
  const planningEntries = await Store.getAll("planningEntries");
  const existingEntry = planningEntries.find((p) => p.date === dateStr);
  const allTimes = await Store.getAll("visitTimes");

  let dayTourneeId = existingEntry?.tourneeId || null;
  let dayClients = [];

  if (existingEntry?.tourneeId) {
    const t = await Store.get("tournees", existingEntry.tourneeId);
    if (t) {
      const timesForDay = new Map(allTimes.filter((v) => v.date === dateStr).map((v) => [v.clientId, v]));
      dayClients = t.clientIds.map((id, i) => {
        const c = allClients.find((x) => x.id === id);
        const time = timesForDay.get(id);
        return {
          id,
          name: t.clientNames[i],
          postalCode: c ? c.postalCode : "",
          address: c ? c.address : "",
          city: c ? c.city : "",
          lat: c ? c.lat : null,
          lng: c ? c.lng : null,
          startMinutes: time ? time.startMinutes : null,
          durationMinutes: time ? time.durationMinutes : null,
        };
      });
      if (dayClients.some((c) => c.startMinutes == null)) {
        autoAssignMissingTimes(dayClients, visits);
      }
    }
  }

  const defenseCodes = settings.defenseDayCodes || [];
  let currentDefenseCode = (!existingEntry?.tourneeId && existingEntry?.label && defenseCodes.includes(existingEntry.label)) ? existingEntry.label : "";

  const dateObj = new Date(dateStr + "T12:00:00");
  const totalMinutes = DAY_END - DAY_START;
  const timelineHeight = totalMinutes * PX_PER_MIN;
  const hours = [];
  for (let h = Math.floor(DAY_START / 60); h <= Math.floor(DAY_END / 60); h++) hours.push(h);

  container.innerHTML = `
    <button class="back-btn" id="back-to-month">‹ ${MONTHS[dateObj.getMonth()]} ${dateObj.getFullYear()}</button>
    <h1 style="text-transform:capitalize">${dateObj.toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long" })}</h1>

    ${defenseCodes.length > 0 ? `
      <div class="field" style="max-width:260px">
        <label>Jour spécial (Défense)</label>
        <select id="defense-day-select">
          <option value="">— Aucun —</option>
          ${defenseCodes.map((code) => `<option value="${escapeHtml(code)}" ${currentDefenseCode === code ? "selected" : ""}>${escapeHtml(code)}</option>`).join("")}
        </select>
      </div>
    ` : ""}

    <div id="defense-notice"></div>

    <div class="field" style="max-width:260px" id="add-client-field">
      <select id="add-client-select">
        <option value="">— Ajouter un client à ce jour —</option>
        ${allClients.filter((c) => !dayClients.some((dc) => dc.id === c.id)).map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
      </select>
      <button type="button" class="btn secondary block" id="replace-slot-btn" style="margin-top:8px">🔄 Remplacer un créneau libre</button>
    </div>

    <div id="paste-field" style="max-width:260px;margin-top:8px"></div>

    <div class="card" style="padding:0;overflow:visible">
      <div id="day-timeline" style="position:relative;height:${timelineHeight}px;margin:10px 0">
        ${hours.map((h) => {
          const top = (h * 60 - DAY_START) * PX_PER_MIN;
          return `
            <div style="position:absolute;top:${top}px;left:0;right:0;border-top:1px solid var(--border);"></div>
            <div style="position:absolute;top:${top - 7}px;left:0;font-size:10px;color:var(--text-muted);background:white;padding-right:4px">${pad2(h)}:00</div>
          `;
        }).join("")}
        <div id="blocks-layer" style="position:absolute;top:0;left:38px;right:6px;bottom:0"></div>
      </div>
    </div>

    <p class="muted">Maintenez un rendez-vous et faites-le glisser pour changer l'heure. Touchez-le pour modifier la durée ou le supprimer. Maintenez-le sans bouger pour le copier vers un autre jour.</p>
    <div id="block-editor"></div>
  `;

  container.querySelector("#back-to-month").addEventListener("click", () => {
    location.hash = `#/planning/month-${dateStr.slice(0, 7)}`;
  });

  // Balayage vers la gauche = jour suivant, vers la droite = jour précédent.
  wireHorizontalSwipe(container, (dir) => {
    const d = new Date(dateStr + "T12:00:00");
    d.setDate(d.getDate() + dir);
    const newDateStr = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    location.hash = `#/planning/day-${newDateStr}`;
  });

  function renderDefenseNotice() {
    const notice = container.querySelector("#defense-notice");
    const addClientField = container.querySelector("#add-client-field");
    const pasteField = container.querySelector("#paste-field");
    if (currentDefenseCode) {
      notice.innerHTML = `
        <div class="card" style="background:rgba(201,151,79,0.14);border:none">
          <strong>🪖 Jour de Défense : ${escapeHtml(currentDefenseCode)}</strong>
          <p class="muted" style="margin:4px 0 0">Aucun client ne peut être ajouté ce jour-là. Choisissez "— Aucun —" ci-dessus pour libérer ce jour.</p>
        </div>
      `;
      if (addClientField) addClientField.style.display = "none";
      if (pasteField) pasteField.style.display = "none";
    } else {
      notice.innerHTML = "";
      if (addClientField) addClientField.style.display = "";
      if (pasteField) pasteField.style.display = "";
    }
  }
  renderDefenseNotice();

  const defenseSelect = container.querySelector("#defense-day-select");
  if (defenseSelect) {
    defenseSelect.addEventListener("change", async (e) => {
      currentDefenseCode = e.target.value;
      await saveDefenseDay(currentDefenseCode);
      renderDefenseNotice();
      renderBlocks();
      refreshAddSelect();
      showToast(currentDefenseCode ? `Jour marqué : ${currentDefenseCode}` : "Jour libéré");
    });
  }

  async function saveDefenseDay(code) {
    const existingTimes = await Store.getAll("visitTimes");
    for (const t of existingTimes.filter((t) => t.date === dateStr)) await Store.delete("visitTimes", t.id);
    dayClients = [];
    dayTourneeId = null;

    const currentEntries = await Store.getAll("planningEntries");
    const current = currentEntries.find((p) => p.date === dateStr);
    if (code) {
      await Store.put("planningEntries", { id: current?.id, date: dateStr, tourneeId: null, label: code });
    } else if (current) {
      await Store.delete("planningEntries", current.id);
    }
  }

  function renderBlocks() {
    const layer = container.querySelector("#blocks-layer");
    const layout = layoutOverlaps(dayClients);
    layer.innerHTML = dayClients.map((c, i) => {
      const top = (c.startMinutes - DAY_START) * PX_PER_MIN;
      const height = Math.max(c.durationMinutes * PX_PER_MIN, 26);
      const { col, numCols } = layout[i];
      const widthPct = 100 / numCols;
      const leftPct = col * widthPct;
      const gap = numCols > 1 ? 3 : 0;
      return `
        <div class="appt-block" data-idx="${i}" style="position:absolute;top:${top}px;left:calc(${leftPct}% + ${col > 0 ? gap : 0}px);width:calc(${widthPct}% - ${gap}px);height:${height}px;background:var(--teal);color:white;border-radius:8px;padding:4px 8px;font-size:12px;overflow:hidden;touch-action:none;cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,0.15)">
          <strong style="display:block;line-height:1.2">${escapeHtml(c.name)}</strong>
          <span style="opacity:0.85">${fmtHMDisplay(c.startMinutes)} – ${fmtHMDisplay(c.startMinutes + c.durationMinutes)}</span>
        </div>
      `;
    }).join("");

    layer.querySelectorAll(".appt-block").forEach((block) => {
      wireBlockDrag(block, Number(block.dataset.idx));
    });
  }

  function wireBlockDrag(block, idx) {
    let startY = 0;
    let originalStart = 0;
    let dragging = false;
    let pendingStart = null;
    let longPressTimer = null;
    let longPressFired = false;

    block.addEventListener("pointerdown", (e) => {
      startY = e.clientY;
      originalStart = dayClients[idx].startMinutes;
      dragging = false;
      pendingStart = null;
      longPressFired = false;
      block.setPointerCapture(e.pointerId);
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        if (dragging) return;
        longPressFired = true;
        if (navigator.vibrate) navigator.vibrate(10);
        copyAppointment(idx);
      }, LONG_PRESS_COPY_MS);
    });

    block.addEventListener("pointermove", (e) => {
      if (!block.hasPointerCapture(e.pointerId)) return;
      const deltaY = e.clientY - startY;
      if (Math.abs(deltaY) > 4) {
        dragging = true;
        clearTimeout(longPressTimer);
      }
      if (!dragging) return;
      const deltaMin = Math.round(deltaY / PX_PER_MIN / 15) * 15;
      let newStart = originalStart + deltaMin;
      const duration = dayClients[idx].durationMinutes;
      newStart = Math.max(DAY_START, Math.min(newStart, DAY_END - duration));
      pendingStart = newStart;
      block.style.top = `${(newStart - DAY_START) * PX_PER_MIN}px`;
      const label = block.querySelector("span");
      if (label) label.textContent = `${fmtHMDisplay(newStart)} – ${fmtHMDisplay(newStart + duration)}`;
    });

    block.addEventListener("pointerup", async (e) => {
      clearTimeout(longPressTimer);
      block.releasePointerCapture(e.pointerId);
      if (longPressFired) {
        longPressFired = false;
        dragging = false;
        return;
      }
      if (dragging && pendingStart != null) {
        dayClients[idx].startMinutes = pendingStart;
        await persistDay();
        renderBlocks();
      } else {
        openBlockEditor(idx);
      }
      dragging = false;
    });

    block.addEventListener("pointercancel", () => clearTimeout(longPressTimer));
  }

  function readClipboard() {
    try {
      const raw = sessionStorage.getItem(CLIPBOARD_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function copyAppointment(idx) {
    const c = dayClients[idx];
    const clip = {
      clientId: c.id,
      name: c.name,
      postalCode: c.postalCode || "",
      address: c.address || "",
      city: c.city || "",
      lat: c.lat ?? null,
      lng: c.lng ?? null,
      durationMinutes: c.durationMinutes,
    };
    sessionStorage.setItem(CLIPBOARD_KEY, JSON.stringify(clip));
    showToast(`📋 ${c.name} copié — ouvrez un autre jour et touchez "Coller"`);
    refreshPasteButton();
  }

  function refreshPasteButton() {
    const field = container.querySelector("#paste-field");
    if (!field) return;
    const clip = readClipboard();
    if (!clip) {
      field.innerHTML = "";
      return;
    }
    const alreadyHere = dayClients.some((dc) => dc.id === clip.clientId);
    field.innerHTML = `
      <button type="button" class="btn secondary block" id="paste-btn" ${alreadyHere ? "disabled" : ""}>📋 Coller ${escapeHtml(clip.name)}${alreadyHere ? " (déjà ce jour)" : ""}</button>
      <button type="button" class="back-btn" id="clear-clipboard-btn" style="padding:6px 0 0;font-size:13px">Vider le presse-papier</button>
    `;
    const pasteBtn = field.querySelector("#paste-btn");
    if (pasteBtn && !alreadyHere) {
      pasteBtn.addEventListener("click", async () => {
        addToTodayFromCandidate(
          { id: clip.clientId, name: clip.name, postalCode: clip.postalCode, address: clip.address, city: clip.city, lat: clip.lat, lng: clip.lng },
          clip.durationMinutes
        );
        await persistDay();
        renderBlocks();
        refreshAddSelect();
        refreshPasteButton();
        showToast(`${clip.name} collé sur ce jour`);
      });
    }
    field.querySelector("#clear-clipboard-btn").addEventListener("click", () => {
      sessionStorage.removeItem(CLIPBOARD_KEY);
      refreshPasteButton();
    });
  }

  function openBlockEditor(idx) {
    const c = dayClients[idx];
    const editor = container.querySelector("#block-editor");
    const durH = Math.floor(c.durationMinutes / 60);
    const durM = c.durationMinutes % 60;
    const minuteOptions = [0, 15, 30, 45];
    const closestM = minuteOptions.reduce((a, b) => (Math.abs(b - durM) < Math.abs(a - durM) ? b : a));
    editor.innerHTML = `
      <div class="card" style="background:var(--teal-light)">
        <strong>${escapeHtml(c.name)}</strong>
        ${c.address ? `<p class="muted" style="margin:4px 0 0">${escapeHtml(c.address)}, ${escapeHtml(c.postalCode)} ${escapeHtml(c.city || "")}</p>` : ""}
        <a href="${wazeUrl(c)}" id="waze-btn" class="btn secondary block" style="margin-top:10px;text-decoration:none;display:block;text-align:center">🚗 En route vers ce client (Waze)</a>
        <div class="field" style="margin-top:10px">
          <label>Heure de début</label>
          <input type="time" id="edit-start" value="${fmtHM(c.startMinutes)}">
        </div>
        <label>Durée</label>
        <div class="grid-2">
          <div class="field">
            <select id="edit-duration-h">
              ${Array.from({ length: 9 }, (_, h) => `<option value="${h}" ${h === durH ? "selected" : ""}>${h} h</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <select id="edit-duration-m">
              ${minuteOptions.map((m) => `<option value="${m}" ${m === closestM ? "selected" : ""}>${m} min</option>`).join("")}
            </select>
          </div>
        </div>
        <button type="button" class="btn block" id="edit-save-btn">Enregistrer</button>
        <button type="button" class="btn danger block" id="edit-remove-btn" style="margin-top:8px">Retirer ce client du jour</button>
        <button type="button" class="btn secondary block" id="edit-close-btn" style="margin-top:8px">Fermer</button>
      </div>
    `;
    editor.querySelector("#edit-save-btn").addEventListener("click", async () => {
      const newStart = parseHM(editor.querySelector("#edit-start").value);
      const h = parseInt(editor.querySelector("#edit-duration-h").value, 10) || 0;
      const m = parseInt(editor.querySelector("#edit-duration-m").value, 10) || 0;
      const newDuration = Math.max(15, h * 60 + m);
      dayClients[idx].startMinutes = newStart;
      dayClients[idx].durationMinutes = newDuration;
      await persistDay();
      renderBlocks();
      editor.innerHTML = "";
      showToast("Rendez-vous mis à jour");
    });
    editor.querySelector("#edit-remove-btn").addEventListener("click", async () => {
      dayClients.splice(idx, 1);
      await persistDay();
      renderBlocks();
      refreshAddSelect();
      showToast("Client retiré de ce jour");
      openReplaceSlotPanel();
    });
    editor.querySelector("#edit-close-btn").addEventListener("click", () => {
      editor.innerHTML = "";
    });
  }

  function refreshAddSelect() {
    const select = container.querySelector("#add-client-select");
    select.innerHTML = `
      <option value="">— Ajouter un client à ce jour —</option>
      ${allClients.filter((c) => !dayClients.some((dc) => dc.id === c.id)).map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
    `;
  }

  // --- "Remplacer un créneau libre" : avance de rentrer, avancer un client
  // déjà planifié plus tard, ou proposer le créneau à un client en attente.

  function addToTodayFromCandidate(clientInfo, durationMinutes) {
    const lastEnd = dayClients.reduce((max, dc) => Math.max(max, dc.startMinutes + dc.durationMinutes), DAY_START);
    dayClients.push({
      id: clientInfo.id,
      name: clientInfo.name,
      postalCode: clientInfo.postalCode || "",
      address: clientInfo.address || "",
      city: clientInfo.city || "",
      lat: clientInfo.lat ?? null,
      lng: clientInfo.lng ?? null,
      startMinutes: Math.min(lastEnd + 15, DAY_END - Math.max(15, durationMinutes)),
      durationMinutes: Math.max(15, durationMinutes || 60),
    });
  }

  function openReplaceSlotPanel() {
    const editor = container.querySelector("#block-editor");
    editor.innerHTML = `
      <div class="card" style="background:var(--teal-light)">
        <strong>Créneau libre — que voulez-vous faire ?</strong>
        <button type="button" class="btn secondary block" style="margin-top:10px" id="opt-home">🏠 Rentrer chez moi</button>
        <button type="button" class="btn secondary block" style="margin-top:8px" id="opt-advance">⏩ Avancer un client déjà planifié plus tard</button>
        <button type="button" class="btn secondary block" style="margin-top:8px" id="opt-waitlist">📋 Proposer ce créneau à un client en attente</button>
        <button type="button" class="btn block" style="margin-top:8px" id="opt-close">Fermer</button>
      </div>
    `;
    editor.querySelector("#opt-home").addEventListener("click", () => {
      editor.innerHTML = "";
      showToast("Bonne route ! 🚐");
    });
    editor.querySelector("#opt-close").addEventListener("click", () => {
      editor.innerHTML = "";
    });
    editor.querySelector("#opt-advance").addEventListener("click", () => showAdvanceCandidate());
    editor.querySelector("#opt-waitlist").addEventListener("click", () => showWaitlistCandidate(0));
  }

  async function showAdvanceCandidate() {
    const editor = container.querySelector("#block-editor");
    const allTimes = await Store.getAll("visitTimes");
    const future = allTimes
      .filter((v) => v.date > dateStr)
      .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes);

    if (future.length === 0) {
      editor.innerHTML = `
        <div class="card">
          <p class="muted" style="margin:0">Aucun rendez-vous planifié à l'avenir pour l'instant.</p>
          <button type="button" class="btn secondary block" style="margin-top:10px" id="back-btn-advance">‹ Retour</button>
        </div>
      `;
      editor.querySelector("#back-btn-advance").addEventListener("click", openReplaceSlotPanel);
      return;
    }

    const candidate = future[0];
    const candidateDate = new Date(candidate.date + "T12:00:00");
    editor.innerHTML = `
      <div class="card" style="background:var(--teal-light)">
        <strong>${escapeHtml(candidate.clientName)}</strong>
        <p class="muted" style="margin:4px 0 0">Prévu le ${candidateDate.toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long" })} à ${fmtHMDisplay(candidate.startMinutes)}</p>
        <button type="button" class="btn block" style="margin-top:10px" id="confirm-advance-btn">Avancer à aujourd'hui</button>
        <button type="button" class="btn secondary block" style="margin-top:8px" id="back-btn-advance2">‹ Retour</button>
      </div>
    `;
    editor.querySelector("#confirm-advance-btn").addEventListener("click", async () => {
      await Store.delete("visitTimes", candidate.id);
      const origEntries = await Store.getAll("planningEntries");
      const origEntry = origEntries.find((p) => p.date === candidate.date);
      if (origEntry?.tourneeId) {
        const t = await Store.get("tournees", origEntry.tourneeId);
        if (t) {
          const idx2 = t.clientIds.indexOf(candidate.clientId);
          if (idx2 >= 0) {
            t.clientIds.splice(idx2, 1);
            t.clientNames.splice(idx2, 1);
            if (t.clientIds.length > 0) {
              await Store.put("tournees", t);
            } else {
              await Store.delete("planningEntries", origEntry.id);
            }
          }
        }
      }
      const c = allClients.find((x) => x.id === candidate.clientId);
      addToTodayFromCandidate(
        { id: candidate.clientId, name: candidate.clientName, postalCode: c?.postalCode, address: c?.address, city: c?.city, lat: c?.lat, lng: c?.lng },
        candidate.durationMinutes
      );
      await persistDay();
      renderBlocks();
      refreshAddSelect();
      editor.innerHTML = "";
      showToast(`${candidate.clientName} avancé à aujourd'hui`);
    });
    editor.querySelector("#back-btn-advance2").addEventListener("click", openReplaceSlotPanel);
  }

  async function showWaitlistCandidate(skipIndex) {
    const editor = container.querySelector("#block-editor");
    const waitlist = await Store.getAll("waitlist");
    waitlist.sort((a, b) => a.targetMonth.localeCompare(b.targetMonth) || (a.createdAt || "").localeCompare(b.createdAt || ""));

    if (waitlist.length === 0) {
      editor.innerHTML = `
        <div class="card">
          <p class="muted" style="margin:0">Aucun client en liste d'attente pour l'instant.</p>
          <button type="button" class="btn secondary block" style="margin-top:10px" id="back-btn-wl">‹ Retour</button>
        </div>
      `;
      editor.querySelector("#back-btn-wl").addEventListener("click", openReplaceSlotPanel);
      return;
    }

    const index = skipIndex % waitlist.length;
    const candidate = waitlist[index];
    editor.innerHTML = `
      <div class="card" style="background:var(--teal-light)">
        <strong>${escapeHtml(candidate.name)}</strong>
        <p class="muted" style="margin:4px 0 0">${escapeHtml(candidate.postalCode)} ${escapeHtml(candidate.city || "")} — en attente pour ${monthLabel(candidate.targetMonth)}</p>
        <p class="muted">Proposez-lui ce créneau aujourd'hui, s'il vous confirme être disponible.</p>
        <button type="button" class="btn block" style="margin-top:6px" id="confirm-wl-btn">Programmer aujourd'hui</button>
        ${waitlist.length > 1 ? `<button type="button" class="btn secondary block" style="margin-top:8px" id="skip-wl-btn">Voir un autre client</button>` : ""}
        <button type="button" class="btn secondary block" style="margin-top:8px" id="back-btn-wl2">‹ Retour</button>
      </div>
    `;
    editor.querySelector("#confirm-wl-btn").addEventListener("click", async () => {
      let clientId = candidate.clientId;
      let clientRecord = clientId ? allClients.find((c) => c.id === clientId) : null;
      if (!clientId) {
        const newClient = await Store.put("clients", {
          name: candidate.name,
          address: candidate.address || "",
          postalCode: candidate.postalCode,
          city: candidate.city || "",
          phone: candidate.phone || "",
          email: candidate.email || "",
          serviceTypes: candidate.serviceType ? [candidate.serviceType] : [],
          frequency: "ponctuel",
          notes: candidate.notes || "",
          lat: candidate.lat ?? null,
          lng: candidate.lng ?? null,
        });
        clientId = newClient.id;
        clientRecord = newClient;
        allClients.push(newClient);
      }
      addToTodayFromCandidate(
        { id: clientId, name: candidate.name, postalCode: candidate.postalCode, address: candidate.address, city: candidate.city, lat: clientRecord?.lat ?? candidate.lat, lng: clientRecord?.lng ?? candidate.lng },
        60
      );
      await Store.delete("waitlist", candidate.id);
      await persistDay();
      renderBlocks();
      refreshAddSelect();
      editor.innerHTML = "";
      showToast(`${candidate.name} programmé aujourd'hui`);
    });
    const skipBtn = editor.querySelector("#skip-wl-btn");
    if (skipBtn) skipBtn.addEventListener("click", () => showWaitlistCandidate(index + 1));
    editor.querySelector("#back-btn-wl2").addEventListener("click", openReplaceSlotPanel);
  }

  container.querySelector("#replace-slot-btn").addEventListener("click", openReplaceSlotPanel);

  container.querySelector("#add-client-select").addEventListener("change", async (e) => {
    const id = e.target.value;
    if (!id) return;
    const c = allClients.find((x) => x.id === id);
    if (!c) return;
    const lastEnd = dayClients.reduce((max, dc) => Math.max(max, dc.startMinutes + dc.durationMinutes), DAY_START);
    const visitsForClient = visits.filter((v) => v.clientId === c.id);
    const avgMin = visitsForClient.length > 0
      ? Math.round(visitsForClient.reduce((s, v) => s + v.durationSeconds, 0) / visitsForClient.length / 60)
      : 60;
    dayClients.push({
      id: c.id,
      name: c.name,
      postalCode: c.postalCode,
      address: c.address,
      city: c.city,
      lat: c.lat,
      lng: c.lng,
      startMinutes: Math.min(lastEnd + 15, DAY_END - Math.max(15, avgMin)),
      durationMinutes: Math.max(15, avgMin),
    });
    await persistDay();
    renderBlocks();
    refreshAddSelect();
    showToast("Client ajouté à ce jour");
  });

  async function persistDay() {
    const existingTimes = await Store.getAll("visitTimes");
    for (const t of existingTimes.filter((t) => t.date === dateStr)) await Store.delete("visitTimes", t.id);
    for (const c of dayClients) {
      await Store.put("visitTimes", {
        id: `${dateStr}_${c.id}`,
        date: dateStr,
        clientId: c.id,
        clientName: c.name,
        startMinutes: c.startMinutes,
        durationMinutes: c.durationMinutes,
      });
    }

    const currentEntries = await Store.getAll("planningEntries");
    const current = currentEntries.find((p) => p.date === dateStr);

    if (dayClients.length > 0) {
      const base = settings.baseLat != null ? { lat: settings.baseLat, lng: settings.baseLng } : null;
      const ordered = [...dayClients].sort((a, b) => a.startMinutes - b.startMinutes);
      const tournee = await Store.put("tournees", {
        id: dayTourneeId || undefined,
        name: `Jour du ${dateStr}`,
        clientIds: dayClients.map((c) => c.id),
        clientNames: dayClients.map((c) => c.name),
        km: computeRouteKm(ordered, base),
      });
      dayTourneeId = tournee.id;
      await Store.put("planningEntries", { id: current?.id, date: dateStr, tourneeId: tournee.id, label: tournee.name });
    } else if (current) {
      await Store.delete("planningEntries", current.id);
    }
  }

  renderBlocks();
  refreshPasteButton();

  const scrollHost = container.closest(".view") || container;
  const timeline = container.querySelector("#day-timeline");
  if (scrollHost && timeline) {
    const timelineTop = timeline.offsetTop;
    scrollHost.scrollTop = timelineTop + SCROLL_TO_HOUR * 60 * PX_PER_MIN - 40;
  }
}

function autoAssignMissingTimes(dayClients, visits) {
  let cursor = 8 * 60;
  for (const c of dayClients) {
    if (c.startMinutes != null) {
      cursor = Math.max(cursor, c.startMinutes + (c.durationMinutes || 60));
      continue;
    }
    const clientVisits = visits.filter((v) => v.clientId === c.id);
    const avgMin = clientVisits.length > 0
      ? Math.round(clientVisits.reduce((s, v) => s + v.durationSeconds, 0) / clientVisits.length / 60)
      : 60;
    const duration = Math.max(15, avgMin);
    c.startMinutes = cursor;
    c.durationMinutes = duration;
    cursor += duration + 15;
  }
}
