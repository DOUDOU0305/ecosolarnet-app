import { Store } from "../db.js";
import { classifyRegion, geocodeAddress, fullAddress } from "../geo.js";
import { showToast, escapeHtml } from "../toast.js";

const SERVICE_LABELS = {
  vitres: "Vitres",
  veranda: "Véranda",
  pergola: "Pergola",
  carport: "Carport",
  panneaux: "Panneaux solaires",
};

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

  container.innerHTML = `
    <h1>Clients</h1>
    ${clients.length === 0 ? `
      <div class="empty-state">
        <div class="big">👤</div>
        <p>Aucun client pour l'instant.<br>Ajoutez votre premier client avec le bouton +.</p>
      </div>
    ` : `
      <div class="card">
        ${clients.map((c) => `
          <div class="list-item" data-id="${c.id}">
            <div>
              <div><strong>${escapeHtml(c.name)}</strong></div>
              <div class="muted">${escapeHtml(c.postalCode)} ${escapeHtml(c.city)}</div>
              <div style="margin-top:4px">
                <span class="pill ${regionPillClass(classifyRegion(c.postalCode))}">${classifyRegion(c.postalCode)}</span>
                ${(c.serviceTypes || []).map((s) => `<span class="pill" style="margin-left:4px">${SERVICE_LABELS[s] || s}</span>`).join("")}
              </div>
            </div>
            <span style="color:var(--text-muted)">›</span>
          </div>
        `).join("")}
      </div>
    `}
    <button class="fab" id="add-client-btn">+</button>
  `;

  container.querySelectorAll(".list-item").forEach((el) => {
    el.addEventListener("click", () => {
      location.hash = `#/clients/${el.dataset.id}`;
    });
  });
  container.querySelector("#add-client-btn").addEventListener("click", () => {
    location.hash = "#/clients/new";
  });
}

async function renderForm(container, id) {
  const client = id ? await Store.get("clients", id) : null;

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
        <input name="address" required value="${escapeHtml(client?.address || "")}" placeholder="Rue et numéro">
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Code postal *</label>
          <input name="postalCode" required value="${escapeHtml(client?.postalCode || "")}" placeholder="6280" inputmode="numeric">
        </div>
        <div class="field">
          <label>Ville *</label>
          <input name="city" required value="${escapeHtml(client?.city || "")}" placeholder="Gerpinnes">
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
  `;

  container.querySelector("#back-btn").addEventListener("click", () => {
    location.hash = "#/clients";
  });

  if (client) {
    container.querySelector("#delete-btn").addEventListener("click", async () => {
      if (confirm(`Supprimer ${client.name} ?`)) {
        await Store.delete("clients", client.id);
        showToast("Client supprimé");
        location.hash = "#/clients";
      }
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
      lat: client?.lat ?? null,
      lng: client?.lng ?? null,
    };
    const saved = await Store.put("clients", record);
    showToast("Client enregistré");

    // Géocodage en arrière-plan (n'empêche pas de continuer à utiliser l'appli)
    geocodeAddress(fullAddress(saved))
      .then((coords) => {
        if (coords) Store.put("clients", { ...saved, lat: coords.lat, lng: coords.lng });
      })
      .catch(() => {});

    location.hash = "#/clients";
  });
}
