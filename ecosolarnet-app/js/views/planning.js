import { Store, getSettings } from "../db.js";
import { haversineKm, postalCodeRoughDistance, computeRouteKm } from "../geo.js";
import { showToast, escapeHtml } from "../toast.js";
import { renderYear, renderMonth, renderDay } from "./calendar.js";

let lastOptions = null; // options de tournées générées (non encore enregistrées)

const SWIPE_OPEN_X = -84;
let openSwipeRow = null;

function closeSwipeRow(row) {
  if (!row) return;
  const content = row.querySelector(".swipe-content");
  if (content) content.style.transform = "translateX(0)";
  row.classList.remove("swipe-open");
  if (openSwipeRow === row) openSwipeRow = null;
}

function wireSwipeRows(container, onDelete) {
  container.querySelectorAll(".swipe-row").forEach((row) => {
    const content = row.querySelector(".swipe-content");
    const deleteBtn = row.querySelector(".swipe-delete-btn");
    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let dragging = false;
    let axis = null;

    content.addEventListener("pointerdown", (e) => {
      if (openSwipeRow && openSwipeRow !== row) closeSwipeRow(openSwipeRow);
      startX = e.clientX;
      startY = e.clientY;
      baseX = row.classList.contains("swipe-open") ? SWIPE_OPEN_X : 0;
      dragging = true;
      axis = null;
      content.style.transition = "none";
      content.setPointerCapture(e.pointerId);
    });

    content.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (axis === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (axis !== "x") return;
      const x = Math.min(0, Math.max(SWIPE_OPEN_X, baseX + dx));
      content.style.transform = `translateX(${x}px)`;
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      content.style.transition = "";
      if (axis !== "x") return;
      const dx = e.clientX - startX;
      const finalX = baseX + dx;
      if (finalX < SWIPE_OPEN_X / 2) {
        content.style.transform = `translateX(${SWIPE_OPEN_X}px)`;
        row.classList.add("swipe-open");
        openSwipeRow = row;
      } else {
        closeSwipeRow(row);
      }
    }

    content.addEventListener("pointerup", endDrag);
    content.addEventListener("pointercancel", endDrag);

    content.addEventListener("click", (e) => {
      if (row.classList.contains("swipe-open")) {
        e.preventDefault();
        e.stopPropagation();
        closeSwipeRow(row);
      }
    });

    deleteBtn.addEventListener("click", () => onDelete(row.dataset.id));
  });
}

function formatTourneeName(name) {
  const m = /^Jour du (\d{4})-(\d{2})-(\d{2})$/.exec(name || "");
  if (!m) return name;
  return `Jour du ${m[3]}/${m[2]}/${m[1]}`;
}

async function deleteTournee(id) {
  const tournee = await Store.get("tournees", id);
  await Store.delete("tournees", id);
  const dateMatch = /^Jour du (\d{4}-\d{2}-\d{2})$/.exec(tournee?.name || "");
  if (dateMatch) {
    const dateStr = dateMatch[1];
    const [entries, times] = await Promise.all([Store.getAll("planningEntries"), Store.getAll("visitTimes")]);
    const entry = entries.find((p) => p.date === dateStr);
    if (entry) await Store.delete("planningEntries", entry.id);
    for (const t of times.filter((t) => t.date === dateStr)) await Store.delete("visitTimes", t.id);
  }
}

export async function render(container, params) {
  const id = params?.id;
  if (id) {
    if (id.startsWith("year-")) return renderYear(container, Number(id.slice(5)));
    if (id.startsWith("month-")) return renderMonth(container, id.slice(6));
    if (id.startsWith("day-")) return renderDay(container, id.slice(4));
  }
  return renderMain(container);
}

async function backfillMissingKm(savedTournees, settings) {
  const missing = savedTournees.filter((t) => t.km == null && t.clientIds?.length > 0);
  if (missing.length === 0) return;
  const base = settings.baseLat != null ? { lat: settings.baseLat, lng: settings.baseLng } : null;
  if (!base) return;
  const [allClients, allTimes] = await Promise.all([Store.getAll("clients"), Store.getAll("visitTimes")]);
  const clientById = new Map(allClients.map((c) => [c.id, c]));
  for (const t of missing) {
    const dateMatch = /^Jour du (\d{4}-\d{2}-\d{2})$/.exec(t.name || "");
    const timesForDay = dateMatch
      ? new Map(allTimes.filter((v) => v.date === dateMatch[1]).map((v) => [v.clientId, v]))
      : null;
    const ordered = t.clientIds
      .map((id) => {
        const c = clientById.get(id);
        if (!c) return null;
        return { lat: c.lat, lng: c.lng, startMinutes: timesForDay?.get(id)?.startMinutes ?? 0 };
      })
      .filter(Boolean)
      .sort((a, b) => a.startMinutes - b.startMinutes);
    const km = computeRouteKm(ordered, base);
    if (km != null) {
      t.km = km;
      await Store.put("tournees", t);
    }
  }
}

async function renderMain(container) {
  const settings = await getSettings();
  const clients = await Store.getAll("clients");

  container.innerHTML = `
    <h1>Tournées & Planning</h1>

    <div class="card">
      <h3 style="margin-top:0">Générer les tournées</h3>
      <p class="muted">Regroupe vos ${clients.length} client${clients.length > 1 ? "s" : ""} par code postal pour limiter les kilomètres. Maximum ${settings.maxClientsPerDay} clients par tournée (réglable dans Réglages).</p>
      <button class="btn block" id="generate-btn" ${clients.length === 0 ? "disabled" : ""}>Proposer des tournées</button>
      <div id="options-zone"></div>
    </div>

    <div class="card" id="saved-tournees-zone"></div>

    <div class="card">
      <h3 style="margin-top:0">Calendrier</h3>
      <p class="muted">Vue par année, mois et jour — glissez un rendez-vous pour changer son heure.</p>
      <button class="btn block" id="open-calendar-btn">📅 Voir le calendrier</button>
    </div>
  `;

  await refreshSavedTourneesZone(container, settings);

  container.querySelector("#generate-btn")?.addEventListener("click", async () => {
    await handleGenerate(container, clients, settings);
  });

  container.querySelector("#open-calendar-btn").addEventListener("click", () => {
    location.hash = `#/planning/year-${new Date().getFullYear()}`;
  });
}

function tourneeSortKey(t) {
  const m = /^Jour du (\d{4}-\d{2}-\d{2})$/.exec(t.name || "");
  if (m) return m[1];
  return `zzzz-${String(t.order ?? 0).padStart(6, "0")}`;
}

async function refreshSavedTourneesZone(container, settings) {
  const savedTournees = await Store.getAll("tournees");
  savedTournees.sort((a, b) => tourneeSortKey(a).localeCompare(tourneeSortKey(b)));
  await backfillMissingKm(savedTournees, settings);

  const zone = container.querySelector("#saved-tournees-zone");
  zone.innerHTML = `
    <h3 style="margin-top:0">Mes tournées enregistrées</h3>
    ${savedTournees.length === 0
      ? `<p class="muted">Aucune tournée enregistrée pour le moment. Générez-en une ci-dessus.</p>`
      : `<p class="muted" style="font-size:12px">Glissez une ligne vers la gauche pour la supprimer.</p>${renderSavedTournees(savedTournees)}`}
  `;

  openSwipeRow = null;
  wireSwipeRows(zone, async (id) => {
    await deleteTournee(id);
    showToast("Tournée supprimée");
    await refreshSavedTourneesZone(container, settings);
  });
}

function renderSavedTournees(savedTournees) {
  return savedTournees.map((t) => `
    <div class="swipe-row" style="border-radius:var(--radius-lg);margin-bottom:10px" data-id="${t.id}">
      <button type="button" class="swipe-delete-btn">Supprimer</button>
      <div class="swipe-content" style="border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:14px">
        <div class="card-row">
          <strong>${escapeHtml(formatTourneeName(t.name))}</strong>
          <span class="pill">${t.km != null ? Math.round(t.km) + " km" : "km inconnu"}</span>
        </div>
        <p class="muted" style="margin:6px 0 0">${t.clientNames.join(", ")}</p>
      </div>
    </div>
  `).join("");
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
      await refreshSavedTourneesZone(container, settings);
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
