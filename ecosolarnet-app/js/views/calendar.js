import { Store, getSettings } from "../db.js";
import { showToast, escapeHtml } from "../toast.js";
import { wazeUrl } from "../geo.js";

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DAY_START = 0; // minuit
const DAY_END = 24 * 60; // minuit le lendemain
const SCROLL_TO_HOUR = 7; // défilement automatique vers cette heure à l'ouverture
const PX_PER_MIN = 1.2;

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

function parseHM(str) {
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
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
    const isToday = dateStr === today;
    cells += `
      <button type="button" class="cal-day-btn${isToday ? " cal-today" : ""}" data-date="${dateStr}"
        style="aspect-ratio:1;border:1px solid ${isToday ? "var(--danger)" : "var(--border)"};border-radius:8px;background:${entry ? "var(--teal-light)" : "white"};font-family:inherit;font-size:13px;padding:2px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;cursor:pointer">
        <span style="${isToday ? "background:var(--danger);color:white;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-weight:700" : "font-weight:400"}">${d}</span>
        ${entry ? `<span style="width:5px;height:5px;border-radius:50%;background:var(--teal-dark)"></span>` : ""}
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
  container.querySelector("#prev-month").addEventListener("click", () => {
    const prev = month === 1 ? `${year - 1}-12` : `${year}-${pad2(month - 1)}`;
    location.hash = `#/planning/month-${prev}`;
  });
  container.querySelector("#next-month").addEventListener("click", () => {
    const next = month === 12 ? `${year + 1}-01` : `${year}-${pad2(month + 1)}`;
    location.hash = `#/planning/month-${next}`;
  });
  container.querySelectorAll("[data-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = `#/planning/day-${btn.dataset.date}`;
    });
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

  const dateObj = new Date(dateStr + "T12:00:00");
  const totalMinutes = DAY_END - DAY_START;
  const timelineHeight = totalMinutes * PX_PER_MIN;
  const hours = [];
  for (let h = Math.floor(DAY_START / 60); h <= Math.floor(DAY_END / 60); h++) hours.push(h);

  container.innerHTML = `
    <button class="back-btn" id="back-to-month">‹ ${MONTHS[dateObj.getMonth()]} ${dateObj.getFullYear()}</button>
    <h1 style="text-transform:capitalize">${dateObj.toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long" })}</h1>

    <div class="field" style="max-width:260px">
      <select id="add-client-select">
        <option value="">— Ajouter un client à ce jour —</option>
        ${allClients.filter((c) => !dayClients.some((dc) => dc.id === c.id)).map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
      </select>
    </div>

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

    <p class="muted">Maintenez un rendez-vous et faites-le glisser pour changer l'heure. Touchez-le pour modifier la durée ou le supprimer.</p>
    <div id="block-editor"></div>
  `;

  container.querySelector("#back-to-month").addEventListener("click", () => {
    location.hash = `#/planning/month-${dateStr.slice(0, 7)}`;
  });

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
          <span style="opacity:0.85">${fmtHM(c.startMinutes)} – ${fmtHM(c.startMinutes + c.durationMinutes)}</span>
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

    block.addEventListener("pointerdown", (e) => {
      startY = e.clientY;
      originalStart = dayClients[idx].startMinutes;
      dragging = false;
      pendingStart = null;
      block.setPointerCapture(e.pointerId);
    });

    block.addEventListener("pointermove", (e) => {
      if (!block.hasPointerCapture(e.pointerId)) return;
      const deltaY = e.clientY - startY;
      if (Math.abs(deltaY) > 4) dragging = true;
      if (!dragging) return;
      const deltaMin = Math.round(deltaY / PX_PER_MIN / 15) * 15;
      let newStart = originalStart + deltaMin;
      const duration = dayClients[idx].durationMinutes;
      newStart = Math.max(DAY_START, Math.min(newStart, DAY_END - duration));
      pendingStart = newStart;
      block.style.top = `${(newStart - DAY_START) * PX_PER_MIN}px`;
      const label = block.querySelector("span");
      if (label) label.textContent = `${fmtHM(newStart)} – ${fmtHM(newStart + duration)}`;
    });

    block.addEventListener("pointerup", async (e) => {
      block.releasePointerCapture(e.pointerId);
      if (dragging && pendingStart != null) {
        dayClients[idx].startMinutes = pendingStart;
        await persistDay();
        renderBlocks();
      } else {
        openBlockEditor(idx);
      }
      dragging = false;
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
      editor.innerHTML = "";
      refreshAddSelect();
      showToast("Client retiré de ce jour");
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
      const tournee = await Store.put("tournees", {
        id: dayTourneeId || undefined,
        name: `Jour du ${dateStr}`,
        clientIds: dayClients.map((c) => c.id),
        clientNames: dayClients.map((c) => c.name),
        km: null,
      });
      dayTourneeId = tournee.id;
      await Store.put("planningEntries", { id: current?.id, date: dateStr, tourneeId: tournee.id, label: tournee.name });
    } else if (current) {
      await Store.delete("planningEntries", current.id);
    }
  }

  renderBlocks();

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
