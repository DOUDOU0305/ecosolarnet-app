import { Store } from "../db.js";
import { classifyRegion, geocodeAddress, fullAddress } from "../geo.js";
import { showToast, escapeHtml } from "../toast.js";
import { formatDuration } from "../timer.js";
import { wireAddressAutocomplete, wirePostalCityCross } from "../addressAutocomplete.js";

const SERVICE_LABELS = {
  vitres: "Vitres",
  veranda: "Véranda",
  pergola: "Pergola",
  carport: "Carport",
  panneaux: "Panneaux solaires",
};

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

    deleteBtn.addEventListener("click", () => onDelete(row.dataset.visitId));
  });
}

const FREQ_LABELS = {
  mensuel: "Chaque mois",
  bimestriel: "Tous les 2 mois",
  trimestriel: "Tous les 3 mois",
  semestriel: "Tous les 6 mois",
  annuel: "1 fois par an",
  ponctuel: "Ponctuel",
};

function regionPillClass(region) {
  if (region === "Bruxelles") return "region-bruxelles";
  if (region === "Hainaut") return "region-hainaut";
  return "region-autre";
}

export async function render(container, params) {
  if (params && params.id) {
    return renderForm(container, params.id === "new" ? null : params.id);
  }
  return renderList(container);
}

async function renderList(container) {
  const clients = await Store.getAll("clients");
  clients.sort((a, b) => a.name.localeCompare(b.name));
  const visits = await Store.getAll("visits");

  function avgDurationFor(clientId) {
    const list = visits.filter((v) => v.clientId === clientId);
    if (list.length === 0) return null;
    const avg = list.reduce((s, v) => s + v.durationSeconds, 0) / list.length;
    return { avg, count: list.length };
  }

  container.innerHTML = `
    <h1>Clients</h1>
    <div class="stat-row" style="grid-template-columns:1fr">
      <div class="stat-card">
        <div class="num">${clients.length}</div>
        <div class="label">Clients</div>
      </div>
    </div>
    ${clients.length === 0 ? `
      <div class="empty-state">
        <div class="big">👤</div>
        <p>Aucun client pour l'instant.<br>Maintenez le doigt sur "Clients" en bas de l'écran pour en ajouter un.</p>
      </div>
    ` : `
      <div class="card">
        ${clients.map((c) => {
          const t = avgDurationFor(c.id);
          return `
          <div class="list-item" data-id="${c.id}">
            <div>
              <div><strong>${escapeHtml(c.name)}</strong></div>
              <div class="muted">${escapeHtml(c.postalCode)} ${escapeHtml(c.city)}</div>
              <div style="margin-top:4px">
                <span class="pill ${regionPillClass(classifyRegion(c.postalCode))}">${escapeHtml(c.city)}</span>
                ${(c.serviceTypes || []).map((s) => `<span class="pill" style="margin-left:4px">${SERVICE_LABELS[s] || s}</span>`).join("")}
              </div>
            </div>
            <div style="text-align:right">
              <span style="color:var(--text-muted)">›</span>
              ${t ? `<div class="muted" style="font-size:11px;margin-top:4px">⏱ ${formatDuration(t.avg).slice(0, 5)}</div>` : ""}
            </div>
          </div>
        `;
        }).join("")}
      </div>
    `}
  `;

  container.querySelectorAll(".list-item").forEach((el) => {
    el.addEventListener("click", () => {
      location.hash = `#/clients/${el.dataset.id}`;
    });
  });
}

async function renderForm(container, id) {
  const client = id ? await Store.get("clients", id) : null;
  const visits = client ? (await Store.getAll("visits")).filter((v) => v.clientId === client.id) : [];
  visits.sort((a, b) => b.startTime.localeCompare(a.startTime));
  const avgSeconds = visits.length > 0 ? visits.reduce((s, v) => s + v.durationSeconds, 0) / visits.length : null;

  container.innerHTML = `
    <button class="back-btn" id="back-btn">‹ Retour</button>
    <h1>${client ? "Modifier le client" : "Nouveau client"}</h1>
    <form id="client-form" class="card">
      <div class="field">
        <label>Nom du client *</label>
        <input name="name" required value="${escapeHtml(client?.name || "")}" placeholder="Ex: Dupont Jean">
      </div>
      <div class="field">
        <label>Adresse *</label>
        <input name="address" id="address-input" required value="${escapeHtml(client?.address || "")}" placeholder="Commencez à taper l'adresse…" autocomplete="off">
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Code postal *</label>
          <input name="postalCode" id="postal-input" required value="${escapeHtml(client?.postalCode || "")}" placeholder="6280" inputmode="numeric">
        </div>
        <div class="field">
          <label>Ville *</label>
          <input name="city" id="city-input" required value="${escapeHtml(client?.city || "")}" placeholder="Gerpinnes">
        </div>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Téléphone</label>
          <input name="phone" value="${escapeHtml(client?.phone || "")}" type="tel">
        </div>
        <div class="field">
          <label>Email</label>
          <input name="email" value="${escapeHtml(client?.email || "")}" type="email">
        </div>
      </div>

      <label>Prestations</label>
      <div class="field">
        ${Object.entries(SERVICE_LABELS).map(([key, label]) => `
          <div class="checkbox-row">
            <input type="checkbox" name="serviceTypes" value="${key}" id="svc-${key}"
              ${client?.serviceTypes?.includes(key) ? "checked" : ""}>
            <label for="svc-${key}" style="margin:0;font-weight:400;color:var(--text)">${label}</label>
          </div>
        `).join("")}
      </div>

      <div class="field">
        <label>Fréquence de passage</label>
        <select name="frequency">
          ${Object.entries(FREQ_LABELS).map(([key, label]) => `
            <option value="${key}" ${client?.frequency === key ? "selected" : ""}>${label}</option>
          `).join("")}
        </select>
      </div>

      <div class="field">
        <label>Notes</label>
        <textarea name="notes" rows="3">${escapeHtml(client?.notes || "")}</textarea>
      </div>

      <button type="submit" class="btn block">Enregistrer</button>
      ${client ? `<button type="button" id="delete-btn" class="btn danger block" style="margin-top:10px">Supprimer ce client</button>` : ""}
    </form>

    ${client ? `
      <div class="card">
        <h3 style="margin-top:0">Temps passé chez ce client</h3>
        ${visits.length > 0 ? `
          <p class="muted">Moyenne : ${formatDuration(avgSeconds)} sur ${visits.length} passage${visits.length > 1 ? "s" : ""}</p>
          <p class="muted" style="font-size:12px">Glissez une ligne vers la gauche pour la supprimer.</p>
          <div id="visits-list">
            ${visits.slice(0, 8).map((v) => `
              <div class="swipe-row" data-visit-id="${v.id}">
                <button type="button" class="swipe-delete-btn">Supprimer</button>
                <div class="swipe-content list-item">
                  <span>${new Date(v.startTime).toLocaleDateString("fr-BE", { day: "numeric", month: "short", year: "numeric" })}${v.manual ? " (ajouté à la main)" : ""}</span>
                  <strong>${formatDuration(v.durationSeconds)}</strong>
                </div>
              </div>
            `).join("")}
          </div>
        ` : `<p class="muted">Aucun temps enregistré pour l'instant.</p>`}

        <h3 style="margin:16px 0 0">Ajouter un temps manuellement</h3>
        <p class="muted">Pour un ancien passage, ou si vous avez oublié de lancer le chrono.</p>
        <form id="manual-visit-form">
          <div class="field">
            <label>Date</label>
            <input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}" max="${new Date().toISOString().slice(0, 10)}" required>
          </div>
          <div class="grid-2">
            <div class="field">
              <label>Heures</label>
              <input type="number" name="hours" min="0" value="0">
            </div>
            <div class="field">
              <label>Minutes</label>
              <input type="number" name="minutes" min="0" max="59" value="30">
            </div>
          </div>
          <button type="submit" class="btn secondary block">Ajouter ce temps</button>
        </form>
      </div>
    ` : ""}
  `;

  container.querySelector("#back-btn").addEventListener("click", () => {
    location.hash = "#/clients";
  });

  let pickedCoords = null;
  wireAddressAutocomplete({
    addressInput: container.querySelector("#address-input"),
    postalInput: container.querySelector("#postal-input"),
    cityInput: container.querySelector("#city-input"),
    onPick: (coords) => {
      pickedCoords = coords;
    },
  });
  wirePostalCityCross({
    postalInput: container.querySelector("#postal-input"),
    cityInput: container.querySelector("#city-input"),
  });

  if (client) {
    openSwipeRow = null;
    wireSwipeRows(container, async (visitId) => {
      await Store.delete("visits", visitId);
      showToast("Temps supprimé");
      await renderForm(container, client.id);
    });

    container.querySelector("#delete-btn").addEventListener("click", async () => {
      if (confirm(`Supprimer ${client.name} ?`)) {
        await Store.delete("clients", client.id);
        showToast("Client supprimé");
        location.hash = "#/clients";
      }
    });

    container.querySelector("#manual-visit-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const hours = parseInt(fd.get("hours"), 10) || 0;
      const minutes = parseInt(fd.get("minutes"), 10) || 0;
      const durationSeconds = hours * 3600 + minutes * 60;
      if (durationSeconds <= 0) {
        showToast("Indiquez une durée supérieure à 0");
        return;
      }
      const date = fd.get("date");
      await Store.put("visits", {
        clientId: client.id,
        clientName: client.name,
        date,
        startTime: `${date}T12:00:00`,
        endTime: null,
        durationSeconds,
        auto: false,
        manual: true,
      });
      showToast("Temps ajouté");
      await renderForm(container, client.id);
    });
  }

  container.querySelector("#client-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const serviceTypes = fd.getAll("serviceTypes");
    const record = {
      id: client?.id,
      name: fd.get("name").trim(),
      address: fd.get("address").trim(),
      postalCode: fd.get("postalCode").trim(),
      city: fd.get("city").trim(),
      phone: fd.get("phone").trim(),
      email: fd.get("email").trim(),
      serviceTypes,
      frequency: fd.get("frequency"),
      notes: fd.get("notes").trim(),
      lat: pickedCoords?.lat ?? client?.lat ?? null,
      lng: pickedCoords?.lng ?? client?.lng ?? null,
    };
    const saved = await Store.put("clients", record);
    showToast("Client enregistré");

    // Si l'adresse a été choisie dans les suggestions, on a déjà ses coordonnées.
    // Sinon, géocodage en arrière-plan (n'empêche pas de continuer à utiliser l'appli).
    if (!pickedCoords) {
      geocodeAddress(fullAddress(saved))
        .then((coords) => {
          if (coords) Store.put("clients", { ...saved, lat: coords.lat, lng: coords.lng });
        })
        .catch(() => {});
    }

    location.hash = "#/clients";
  });
}
