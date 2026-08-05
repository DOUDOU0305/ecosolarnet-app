import { Store, getSettings } from "../db.js";
import { haversineKm, postalCodeRoughDistance } from "../geo.js";
import { showToast, escapeHtml } from "../toast.js";
import { renderYear, renderMonth, renderDay } from "./calendar.js";

let lastOptions = null; // options de tournées générées (non encore enregistrées)

export async function render(container, params) {
  const id = params?.id;
  if (id) {
    if (id.startsWith("year-")) return renderYear(container, Number(id.slice(5)));
    if (id.startsWith("month-")) return renderMonth(container, id.slice(6));
    if (id.startsWith("day-")) return renderDay(container, id.slice(4));
  }
  return renderMain(container);
}

async function renderMain(container) {
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
      <h3 style="margin-top:0">Calendrier</h3>
      <p class="muted">Vue par année, mois et jour — glissez un rendez-vous pour changer son heure.</p>
      <button class="btn block" id="open-calendar-btn">📅 Voir le calendrier</button>
    </div>
  `;

  container.querySelector("#generate-btn")?.addEventListener("click", async () => {
    await handleGenerate(container, clients, settings);
  });

  container.querySelector("#open-calendar-btn").addEventListener("click", () => {
    location.hash = `#/planning/year-${new Date().getFullYear()}`;
  });
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
