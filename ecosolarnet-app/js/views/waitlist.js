import { Store, getSettings } from "../db.js";
import { geocodeAddress, fullAddress } from "../geo.js";
import { showToast, escapeHtml } from "../toast.js";
import {
  clusterByProximity,
  clusterKm,
  freeWorkdaysInMonth,
  weekdayOf,
  nextMonthStr,
  monthLabel,
  preferenceKeyFor,
  pickBestDay,
} from "../scheduling.js";

const SERVICE_LABELS = {
  vitres: "Nettoyage vitres",
  veranda: "Nettoyage véranda",
  pergola: "Nettoyage pergola",
  carport: "Nettoyage carport",
  panneaux: "Nettoyage panneaux solaires",
};

export async function render(container, params) {
  if (params && params.id === "new") return renderForm(container);
  return renderList(container);
}

async function renderList(container) {
  const settings = await getSettings();
  const entries = await Store.getAll("waitlist");
  entries.sort((a, b) => a.targetMonth.localeCompare(b.targetMonth) || a.name.localeCompare(b.name));
  const months = [...new Set(entries.map((e) => e.targetMonth))].sort();

  container.innerHTML = `
    <h1>Liste d'attente</h1>
    ${months.length === 0 ? `
      <div class="empty-state">
        <div class="big">⏳</div>
        <p>Aucun client en attente.<br>Ajoutez-en un avec le bouton +.</p>
      </div>
    ` : months.map((m) => `
      <div class="card" data-month="${m}">
        <div class="section-title-row">
          <h3 style="margin-top:0;text-transform:capitalize">${monthLabel(m)}</h3>
          <span class="pill">${entries.filter((e) => e.targetMonth === m).length} client(s)</span>
        </div>
        ${entries.filter((e) => e.targetMonth === m).map((e) => `
          <div class="list-item">
            <div>
              <strong>${escapeHtml(e.name)}</strong>
              <div class="muted">${escapeHtml(e.postalCode)} ${escapeHtml(e.city || "")} · ${SERVICE_LABELS[e.serviceType] || ""}</div>
            </div>
            <button type="button" class="btn danger small" data-remove="${e.id}">Retirer</button>
          </div>
        `).join("")}
        <button type="button" class="btn block" data-generate="${m}" style="margin-top:10px">Générer le planning pour ce mois</button>
      </div>
    `).join("")}
    <div id="proposal-zone"></div>
    <button class="fab" id="add-waitlist-btn">+</button>
  `;

  container.querySelector("#add-waitlist-btn").addEventListener("click", () => {
    location.hash = "#/waitlist/new";
  });

  container.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (confirm("Retirer ce client de la liste d'attente ?")) {
        await Store.delete("waitlist", btn.dataset.remove);
        await renderList(container);
      }
    });
  });

  container.querySelectorAll("[data-generate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const month = btn.dataset.generate;
      const monthEntries = entries.filter((e) => e.targetMonth === month);
      btn.disabled = true;
      const originalLabel = btn.textContent;
      btn.textContent = "Calcul en cours…";
      try {
        await handleGenerate(container, month, monthEntries, settings);
      } catch (err) {
        console.error(err);
        showToast("Erreur lors du calcul du planning");
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });
  });
}

async function handleGenerate(container, month, entries, settings) {
  for (const e of entries) {
    if (e.lat == null && e.postalCode) {
      try {
        const coords = await geocodeAddress(fullAddress(e));
        if (coords) {
          e.lat = coords.lat;
          e.lng = coords.lng;
          await Store.put("waitlist", e);
        }
      } catch {
        // pas grave, on continue avec une estimation approximative
      }
    }
  }

  const base = settings.baseLat != null ? { lat: settings.baseLat, lng: settings.baseLng } : null;
  const planningEntries = await Store.getAll("planningEntries");
  const existingDatesSet = new Set(planningEntries.map((p) => p.date));
  const freeDays = freeWorkdaysInMonth(month, settings, existingDatesSet);
  const clusters = clusterByProximity(entries, settings.maxClientsPerDay, base);
  const prefsList = await Store.getAll("schedulingPreferences");
  const preferences = Object.fromEntries(prefsList.map((p) => [p.key, p]));

  const proposedDates = {};
  const usedDays = new Set();
  for (const cluster of clusters) {
    const available = freeDays.filter((d) => !usedDays.has(d));
    let day = null;
    if (available.length > 0) {
      day = pickBestDay(cluster, available, preferences);
      usedDays.add(day);
    }
    for (const item of cluster) proposedDates[item.id] = day;
  }

  renderProposal(container, month, entries, proposedDates);
}

function renderProposal(container, month, entries, proposedDates) {
  const zone = container.querySelector("#proposal-zone");
  const sorted = [...entries].sort((a, b) => {
    const da = proposedDates[a.id] || "9999-99-99";
    const db = proposedDates[b.id] || "9999-99-99";
    return da.localeCompare(db) || a.name.localeCompare(b.name);
  });
  const todayStr = new Date().toISOString().slice(0, 10);
  const unplacedCount = entries.filter((e) => !proposedDates[e.id]).length;

  zone.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0;text-transform:capitalize">Proposition — ${monthLabel(month)}</h2>
      <p class="muted">Vérifiez les dates proposées et ajustez si besoin. Laissez une date vide pour reporter ce client au mois suivant.</p>
      ${unplacedCount > 0 ? `<p class="muted">⚠️ ${unplacedCount} client(s) ne rentrent pas dans les jours libres de ce mois — reportés automatiquement si vous ne leur donnez pas de date.</p>` : ""}
      ${sorted.map((e) => `
        <div class="list-item">
          <div>
            <strong>${escapeHtml(e.name)}</strong>
            <div class="muted">${escapeHtml(e.postalCode)} ${escapeHtml(e.city || "")} · ${SERVICE_LABELS[e.serviceType] || ""}</div>
          </div>
          <input type="date" class="proposal-date" data-entry="${e.id}" value="${proposedDates[e.id] || ""}" min="${todayStr}" style="width:150px;margin:0">
        </div>
      `).join("")}
      <button class="btn block" id="validate-proposal-btn" style="margin-top:14px">Valider ce planning</button>
      <button class="btn secondary block" id="cancel-proposal-btn" style="margin-top:8px">Annuler</button>
    </div>
  `;

  zone.querySelector("#cancel-proposal-btn").addEventListener("click", () => {
    zone.innerHTML = "";
  });

  zone.querySelector("#validate-proposal-btn").addEventListener("click", async () => {
    const btn = zone.querySelector("#validate-proposal-btn");
    btn.disabled = true;
    try {
      await validateProposal(container, month, entries, zone);
    } catch (err) {
      console.error(err);
      showToast("Erreur lors de la validation");
      btn.disabled = false;
    }
  });
}

async function validateProposal(container, month, entries, zone) {
  const dateInputs = zone.querySelectorAll(".proposal-date");
  const finalDates = {};
  dateInputs.forEach((inp) => {
    finalDates[inp.dataset.entry] = inp.value || null;
  });

  const byDate = {};
  for (const e of entries) {
    const date = finalDates[e.id];
    if (!date) continue;
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(e);
  }

  const settings = await getSettings();
  const base = settings.baseLat != null ? { lat: settings.baseLat, lng: settings.baseLng } : null;
  const dates = Object.keys(byDate);

  for (const date of dates) {
    const group = byDate[date];
    const clientIds = [];
    const clientNames = [];
    for (const e of group) {
      let clientId = e.clientId;
      if (!clientId) {
        const newClient = await Store.put("clients", {
          name: e.name,
          address: e.address || "",
          postalCode: e.postalCode,
          city: e.city || "",
          phone: e.phone || "",
          email: e.email || "",
          serviceTypes: e.serviceType ? [e.serviceType] : [],
          frequency: "ponctuel",
          notes: e.notes || "",
          lat: e.lat ?? null,
          lng: e.lng ?? null,
        });
        clientId = newClient.id;
      }
      clientIds.push(clientId);
      clientNames.push(e.name);
    }
    const km = clusterKm(group, base);
    const tournee = await Store.put("tournees", {
      name: `Attente ${monthLabel(month)} — ${date}`,
      clientIds,
      clientNames,
      km,
    });
    await Store.put("planningEntries", { date, tourneeId: tournee.id, label: tournee.name });

    for (const e of group) {
      const key = preferenceKeyFor(e);
      await Store.put("schedulingPreferences", { id: key, key, weekday: weekdayOf(date) });
    }
    for (const e of group) {
      await Store.delete("waitlist", e.id);
    }
  }

  const unplaced = entries.filter((e) => !finalDates[e.id]);
  for (const e of unplaced) {
    await Store.put("waitlist", { ...e, targetMonth: nextMonthStr(month) });
  }

  showToast(`Planning validé : ${dates.length} jour(s) programmé(s)${unplaced.length ? `, ${unplaced.length} reporté(s) au mois suivant` : ""}`);
  zone.innerHTML = "";
  await renderList(container);
}

async function renderForm(container) {
  const clients = await Store.getAll("clients");
  clients.sort((a, b) => a.name.localeCompare(b.name));
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const defaultMonth = nextMonthStr(currentMonthStr);

  container.innerHTML = `
    <button class="back-btn" id="back-btn">‹ Retour</button>
    <h1>Ajouter à la liste d'attente</h1>
    <form id="waitlist-form" class="card">
      <div class="field">
        <label>Client existant (optionnel)</label>
        <select id="client-select">
          <option value="">— Nouveau prospect (saisie libre) —</option>
          ${clients.map((c) => `<option value="${c.id}">${escapeHtml(c.name)} (${c.postalCode})</option>`).join("")}
        </select>
      </div>
      <div id="manual-fields">
        <div class="field">
          <label>Nom *</label>
          <input name="name" placeholder="Nom / société">
        </div>
        <div class="field">
          <label>Adresse</label>
          <input name="address">
        </div>
        <div class="grid-2">
          <div class="field">
            <label>Code postal *</label>
            <input name="postalCode" inputmode="numeric" placeholder="6280">
          </div>
          <div class="field">
            <label>Ville</label>
            <input name="city">
          </div>
        </div>
      </div>
      <div class="field">
        <label>Prestation</label>
        <select name="serviceType">
          ${Object.entries(SERVICE_LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Mois souhaité *</label>
        <input type="month" name="targetMonth" required value="${defaultMonth}">
      </div>
      <div class="field">
        <label>Notes</label>
        <textarea name="notes" rows="2"></textarea>
      </div>
      <button type="submit" class="btn block">Ajouter à la liste d'attente</button>
    </form>
  `;

  const clientSelect = container.querySelector("#client-select");
  const manualFields = container.querySelector("#manual-fields");
  clientSelect.addEventListener("change", () => {
    manualFields.style.display = clientSelect.value ? "none" : "";
  });

  container.querySelector("#back-btn").addEventListener("click", () => {
    location.hash = "#/waitlist";
  });

  container.querySelector("#waitlist-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const clientId = clientSelect.value || null;
    const client = clientId ? clients.find((c) => c.id === clientId) : null;

    const name = client ? client.name : fd.get("name").trim();
    const postalCode = client ? client.postalCode : fd.get("postalCode").trim();
    if (!name || !postalCode) {
      showToast("Indiquez au moins un nom et un code postal");
      return;
    }

    const record = {
      clientId,
      name,
      address: client ? client.address : fd.get("address").trim(),
      postalCode,
      city: client ? client.city : fd.get("city").trim(),
      phone: client ? client.phone : "",
      email: client ? client.email : "",
      serviceType: fd.get("serviceType"),
      targetMonth: fd.get("targetMonth"),
      notes: fd.get("notes").trim(),
      lat: client?.lat ?? null,
      lng: client?.lng ?? null,
      createdAt: new Date().toISOString(),
    };
    const saved = await Store.put("waitlist", record);
    showToast("Ajouté à la liste d'attente");

    if (!client) {
      geocodeAddress(fullAddress(saved))
        .then((coords) => {
          if (coords) Store.put("waitlist", { ...saved, lat: coords.lat, lng: coords.lng });
        })
        .catch(() => {});
    }

    location.hash = "#/waitlist";
  });
}
