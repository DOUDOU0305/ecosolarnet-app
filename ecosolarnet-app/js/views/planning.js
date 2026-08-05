import { Store, getSettings } from "../db.js";
import { haversineKm, postalCodeRoughDistance } from "../geo.js";
import { showToast, escapeHtml } from "../toast.js";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

let currentMonthOffset = 0; // 0 = mois courant
let lastOptions = null; // options de tournées générées (non encore enregistrées)

export async function render(container) {
  const settings = await getSettings();
  const clients = await Store.getAll("clients");
  const savedTournees = await Store.getAll("tournees");
  savedTournees.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  container.innerHTML = `
    <h1>Tournées & Planning</h1>

    <div class="card">
      <h3 style="margin-top:0">Générer les tournées</h3>
      <p class="muted">Regroupe vos ${clients.length} client${clients.length > 1 ? "s" : ""} par code postal pour limiter les kilomètres. Maximum ${settings.maxClientsPerDay} clients par tournée (réglable dans Réglages).</p>
      <button class="btn block" id="generate-btn" ${clients.length === 0 ? "disabled" : ""}>Proposer des tournées</button>
      <div id="options-zone"></div>
    </div>

    <div class="card" id="saved-tournees-zone">
      <h3 style="margin-top:0">Mes tournées enregistrées</h3>
      ${savedTournees.length === 0 ? `<p class="muted">Aucune tournée enregistrée pour le moment. Générez-en une ci-dessus.</p>` : renderSavedTournees(savedTournees)}
    </div>

    <div class="card">
      <div class="section-title-row">
        <h3 style="margin-top:0">Planning mensuel</h3>
      </div>
      <div id="calendar-zone"></div>
    </div>
  `;

  container.querySelector("#generate-btn")?.addEventListener("click", async () => {
    await handleGenerate(container, clients, settings);
  });

  wireSavedTourneeButtons(container);
  await renderCalendar(container, savedTournees);
}

function renderSavedTournees(savedTournees) {
  return savedTournees.map((t, i) => `
    <div class="tour-option">
      <div class="card-row">
        <strong>${escapeHtml(t.name)}</strong>
        <span class="pill">${t.km != null ? Math.round(t.km) + " km" : "km inconnu"}</span>
      </div>
      <p class="muted" style="margin:6px 0 0">${t.clientNames.join(", ")}</p>
    </div>
  `).join("");
}

function wireSavedTourneeButtons(container) {
  // placeholder for future per-tournée actions
}

async function handleGenerate(container, clients, settings) {
  const zone = container.querySelector("#options-zone");
  zone.innerHTML = `<p class="muted">Calcul en cours…</p>`;

  const base = settings.baseLat != null ? { lat: settings.baseLat, lng: settings.baseLng } : null;
  if (!base) {
    zone.innerHTML = `<p class="muted">⚠️ Votre adresse de départ n'est pas encore géolocalisée. Allez dans <strong>Réglages</strong>, enregistrez votre adresse, patientez quelques secondes, puis revenez ici.</p>`;
  }

  const optionA = buildOptionByPostalCode(clients, settings.maxClientsPerDay, base);
  const optionB = buildOptionOptimized(clients, settings.maxClientsPerDay, base);

  lastOptions = { A: optionA, B: optionB };

  zone.innerHTML = `
    <h2>Options proposées</h2>
    ${renderOptionCard("A", "Strict par code postal", optionA, "Regroupe uniquement les clients ayant le même code postal.")}
    ${renderOptionCard("B", "Optimisée (proximité réelle)", optionB, "Ordonne les visites en minimisant la distance parcourue, même entre codes postaux voisins.")}
  `;

  zone.querySelectorAll("[data-choose]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.choose;
      await saveTournees(lastOptions[key].tours);
      showToast("Tournées enregistrées");
      const savedTournees = await Store.getAll("tournees");
      container.querySelector("#saved-tournees-zone").innerHTML = `
        <h3 style="margin-top:0">Mes tournées enregistrées</h3>
        ${renderSavedTournees(savedTournees)}
      `;
      await renderCalendar(container, savedTournees);
      zone.innerHTML = "";
    });
  });
}

function renderOptionCard(key, title, option, description) {
  return `
    <div class="tour-option">
      <div class="card-row">
        <strong>${title}</strong>
        <span class="pill">≈ ${Math.round(option.totalKm)} km total${option.approximate ? " *" : ""}</span>
      </div>
      <p class="muted" style="margin:4px 0 8px">${description}</p>
      ${option.tours.map((t, i) => `
        <div class="day-block">
          <strong>Tournée ${i + 1}</strong> — ${t.clients.length} client${t.clients.length > 1 ? "s" : ""}, ≈ ${Math.round(t.km)} km
          <div class="muted">${t.clients.map((c) => `${c.name} (${c.postalCode})`).join(", ")}</div>
        </div>
      `).join("")}
      ${option.approximate ? `<p class="muted">* estimation approximative : géolocalisation de certains clients en attente.</p>` : ""}
      <button class="btn secondary block" data-choose="${key}">Choisir cette option</button>
    </div>
  `;
}

async function saveTournees(tours) {
  const existing = await Store.getAll("tournees");
  for (const t of existing) await Store.delete("tournees", t.id);
  let order = 0;
  for (const t of tours) {
    await Store.put("tournees", {
      name: `Tournée ${++order}`,
      order,
      clientIds: t.clients.map((c) => c.id),
      clientNames: t.clients.map((c) => c.name),
      km: t.km,
    });
  }
}

// --- Algorithmes de regroupement ---

function buildOptionByPostalCode(clients, maxPerDay, base) {
  const groups = new Map();
  for (const c of clients) {
    const key = c.postalCode || "?";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const tours = [];
  for (const [, group] of groups) {
    for (let i = 0; i < group.length; i += maxPerDay) {
      const chunk = group.slice(i, i + maxPerDay);
      tours.push(computeTour(chunk, base));
    }
  }
  const totalKm = tours.reduce((s, t) => s + t.km, 0);
  const approximate = tours.some((t) => t.approximate);
  return { tours, totalKm, approximate };
}

function buildOptionOptimized(clients, maxPerDay, base) {
  const remaining = [...clients];
  const ordered = [];
  let current = base;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceBetween(current, remaining[i], base);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    ordered.push(next);
    current = next.lat != null ? { lat: next.lat, lng: next.lng } : current;
  }
  const tours = [];
  for (let i = 0; i < ordered.length; i += maxPerDay) {
    tours.push(computeTour(ordered.slice(i, i + maxPerDay), base));
  }
  const totalKm = tours.reduce((s, t) => s + t.km, 0);
  const approximate = tours.some((t) => t.approximate);
  return { tours, totalKm, approximate };
}

function distanceBetween(from, client, base) {
  const fromCoord = from && from.lat != null ? from : base;
  const clientCoord = client.lat != null ? { lat: client.lat, lng: client.lng } : null;
  if (fromCoord && clientCoord) {
    const d = haversineKm(fromCoord, clientCoord);
    if (d != null) return d;
  }
  return postalCodeRoughDistance(from?.postalCode || "0", client.postalCode);
}

function computeTour(clients, base) {
  let approximate = false;
  let km = 0;
  let current = base;
  const withCoords = clients.every((c) => c.lat != null);
  if (!withCoords || !base) approximate = true;

  // ordre glouton (plus proche voisin) à partir du point de départ
  const remaining = [...clients];
  const path = [];
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceBetween(current, remaining[i], base);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    km += bestDist;
    path.push(next);
    current = next.lat != null ? { lat: next.lat, lng: next.lng } : current;
  }
  // retour au point de départ
  if (base && current) {
    const back = current.lat != null ? haversineKm(current, base) : null;
    km += back != null ? back : postalCodeRoughDistance(path[path.length - 1]?.postalCode, base.postalCode || "6280");
  }

  return { clients: path, km, approximate };
}

// --- Calendrier mensuel ---

async function renderCalendar(container, savedTournees) {
  const zone = container.querySelector("#calendar-zone");
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + currentMonthOffset, 1);
  const year = target.getFullYear();
  const month = target.getMonth();

  const entries = await Store.getAll("planningEntries");
  const entryByDate = new Map(entries.map((e) => [e.date, e]));

  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // lundi = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);

  let cells = "";
  for (let i = 0; i < startOffset; i++) cells += `<div></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const entry = entryByDate.get(dateStr);
    const isToday = dateStr === todayStr;
    cells += `
      <button class="cal-day${isToday ? " cal-today" : ""}" data-date="${dateStr}"
        style="aspect-ratio:1;border:1px solid var(--border);border-radius:8px;background:${entry ? "var(--teal-light)" : "white"};font-family:inherit;font-size:12px;padding:2px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;">
        <span style="font-weight:${isToday ? "700" : "400"}">${d}</span>
        ${entry ? `<span style="font-size:9px;color:var(--teal-dark);text-align:center;line-height:1.1">${escapeHtml(entry.label)}</span>` : ""}
      </button>
    `;
  }

  zone.innerHTML = `
    <div class="card-row" style="margin-bottom:10px">
      <button class="btn secondary small" id="prev-month">‹</button>
      <strong>${MONTHS[month]} ${year}</strong>
      <button class="btn secondary small" id="next-month">›</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px">
      ${WEEKDAYS.map((w) => `<div style="text-align:center;font-size:10px;color:var(--text-muted)">${w}</div>`).join("")}
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">${cells}</div>
    <div id="day-editor" style="margin-top:12px"></div>
  `;

  zone.querySelector("#prev-month").addEventListener("click", async () => {
    currentMonthOffset -= 1;
    await renderCalendar(container, savedTournees);
  });
  zone.querySelector("#next-month").addEventListener("click", async () => {
    currentMonthOffset += 1;
    await renderCalendar(container, savedTournees);
  });

  zone.querySelectorAll(".cal-day").forEach((btn) => {
    btn.addEventListener("click", () => openDayEditor(zone, btn.dataset.date, savedTournees, entryByDate.get(btn.dataset.date), container));
  });
}

function openDayEditor(zone, dateStr, savedTournees, existingEntry, container) {
  const editor = zone.querySelector("#day-editor");
  editor.innerHTML = `
    <div class="card" style="background:var(--teal-light)">
      <strong>${new Date(dateStr).toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long" })}</strong>
      <div class="field" style="margin-top:10px">
        <label>Tournée prévue ce jour</label>
        <select id="entry-select">
          <option value="">— Aucune —</option>
          ${savedTournees.map((t) => `<option value="${t.id}" ${existingEntry?.tourneeId === t.id ? "selected" : ""}>${escapeHtml(t.name)} (${t.clientNames.length} clients)</option>`).join("")}
          <option value="__custom" ${existingEntry && !existingEntry.tourneeId ? "selected" : ""}>Autre (texte libre)</option>
        </select>
      </div>
      <div class="field" id="custom-field" style="${existingEntry && !existingEntry.tourneeId ? "" : "display:none"}">
        <label>Description</label>
        <input id="custom-label" value="${escapeHtml(existingEntry && !existingEntry.tourneeId ? existingEntry.label : "")}" placeholder="Ex: RDV fournisseur">
      </div>
      <button class="btn block" id="save-day-btn">Enregistrer ce jour</button>
      ${existingEntry ? `<button class="btn danger block" id="clear-day-btn" style="margin-top:8px">Effacer ce jour</button>` : ""}
    </div>
  `;

  const select = editor.querySelector("#entry-select");
  const customField = editor.querySelector("#custom-field");
  select.addEventListener("change", () => {
    customField.style.display = select.value === "__custom" ? "" : "none";
  });

  editor.querySelector("#save-day-btn").addEventListener("click", async () => {
    const val = select.value;
    if (!val) {
      if (existingEntry) await Store.delete("planningEntries", existingEntry.id);
    } else if (val === "__custom") {
      const label = editor.querySelector("#custom-label").value.trim() || "Note";
      await Store.put("planningEntries", { id: existingEntry?.id, date: dateStr, tourneeId: null, label });
    } else {
      const t = savedTournees.find((t) => t.id === val);
      await Store.put("planningEntries", { id: existingEntry?.id, date: dateStr, tourneeId: t.id, label: t.name });
    }
    showToast("Jour mis à jour");
    await renderCalendar(container, savedTournees);
  });

  if (existingEntry) {
    editor.querySelector("#clear-day-btn").addEventListener("click", async () => {
      await Store.delete("planningEntries", existingEntry.id);
      showToast("Jour effacé");
      await renderCalendar(container, savedTournees);
    });
  }
}
