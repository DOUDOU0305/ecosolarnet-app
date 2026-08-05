import { Store, uid } from "../db.js";
import { getSettings } from "../db.js";
import { classifyRegion, regionRateRange, haversineKm } from "../geo.js";
import { showToast, escapeHtml } from "../toast.js";
import { resizeImage, blobToDataURL } from "../photo.js";

const SERVICE_LABELS = {
  vitres: "Nettoyage vitres",
  veranda: "Nettoyage véranda",
  pergola: "Nettoyage pergola",
  carport: "Nettoyage carport",
  panneaux: "Nettoyage panneaux solaires",
};

const STATUS_LABELS = {
  brouillon: "Brouillon",
  envoye: "Envoyé",
  accepte: "Accepté",
};

const FORMULE_LABELS = { ext: "Extérieur", full: "Intérieur + extérieur" };
const TYPE_LABELS = { ponctuel: "Ponctuel", abonnement: "Abonnement" };

function fmtEuro(n) {
  return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",") + " €";
}

function fmtRange(range) {
  if (!range) return "";
  return range.min === range.max ? `${range.min} €` : `${range.min}–${range.max} €`;
}

export async function render(container, params) {
  if (params && params.id) {
    return renderForm(container, params.id === "new" ? null : params.id);
  }
  return renderList(container);
}

async function renderList(container) {
  const devisList = await Store.getAll("devis");
  devisList.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  container.innerHTML = `
    <h1>Devis</h1>
    ${devisList.length === 0 ? `
      <div class="empty-state">
        <div class="big">📄</div>
        <p>Aucun devis pour l'instant.<br>Créez votre premier devis avec le bouton +.</p>
      </div>
    ` : `
      <div class="card">
        ${devisList.map((d) => `
          <div class="list-item" data-id="${d.id}">
            <div>
              <div><strong>${escapeHtml(d.clientName || "Client")}</strong></div>
              <div class="muted">${SERVICE_LABELS[d.serviceType] || d.serviceType} · ${d.date}</div>
            </div>
            <div style="text-align:right">
              <div><strong>${fmtEuro(d.total)}</strong></div>
              <span class="badge-status badge-${d.status}">${STATUS_LABELS[d.status]}</span>
            </div>
          </div>
        `).join("")}
      </div>
    `}
    <button class="fab" id="add-devis-btn">+</button>
  `;

  container.querySelectorAll(".list-item").forEach((el) => {
    el.addEventListener("click", () => {
      location.hash = `#/devis/${el.dataset.id}`;
    });
  });
  container.querySelector("#add-devis-btn").addEventListener("click", () => {
    location.hash = "#/devis/new";
  });
}

async function renderForm(container, id) {
  const devis = id ? await Store.get("devis", id) : null;
  const settings = await getSettings();
  const clients = await Store.getAll("clients");
  clients.sort((a, b) => a.name.localeCompare(b.name));

  const initialClient = devis?.clientId ? clients.find((c) => c.id === devis.clientId) : null;
  const initialRegion = devis?.region || (initialClient ? classifyRegion(initialClient.postalCode) : "Hainaut");
  const tiers = settings.windowTiers;
  const surcharges = settings.windowSurcharges;

  container.innerHTML = `
    <button class="back-btn" id="back-btn">‹ Retour</button>
    <h1>${devis ? "Modifier le devis" : "Nouveau devis"}</h1>
    <form id="devis-form" class="card">
      <div class="field">
        <label>Client</label>
        <select name="clientId" id="client-select">
          <option value="">— Sans fiche client (saisie libre) —</option>
          ${clients.map((c) => `<option value="${c.id}" ${devis?.clientId === c.id ? "selected" : ""}>${escapeHtml(c.name)} (${c.postalCode})</option>`).join("")}
        </select>
      </div>
      <div class="field" id="manual-name-field" style="${devis?.clientId ? "display:none" : ""}">
        <label>Nom du client</label>
        <input name="clientName" value="${escapeHtml(devis?.clientName || "")}" placeholder="Nom / société">
      </div>

      <div class="field">
        <label>Prestation *</label>
        <select name="serviceType" id="service-select" required>
          ${Object.entries(SERVICE_LABELS).map(([k, l]) => `<option value="${k}" ${devis?.serviceType === k ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>

      <div class="field" id="pricing-mode-field" style="display:none">
        <label>Mode de tarification</label>
        <select id="pricing-mode-select">
          <option value="grille" ${devis?.pricingMode !== "horaire" ? "selected" : ""}>Grille par taille de maison</option>
          <option value="horaire" ${devis?.pricingMode === "horaire" ? "selected" : ""}>Taux horaire</option>
        </select>
      </div>

      <div class="field" id="region-field">
        <label>Région (taux horaire)</label>
        <select name="region" id="region-select">
          <option value="Hainaut" ${initialRegion === "Hainaut" ? "selected" : ""}>Hainaut (${settings.rateHainautMin}-${settings.rateHainautMax} €/h)</option>
          <option value="Bruxelles" ${initialRegion === "Bruxelles" ? "selected" : ""}>Bruxelles (${settings.rateBruxellesMin}-${settings.rateBruxellesMax} €/h)</option>
        </select>
      </div>

      <div id="hourly-fields">
        <div class="grid-2">
          <div class="field">
            <label>Heures estimées</label>
            <input type="number" step="any" min="0" name="hours" id="hours-input" value="${devis?.hours ?? 1}">
          </div>
          <div class="field">
            <label>Taux horaire (€/h)</label>
            <input type="number" step="any" min="0" name="rate" id="rate-input" value="${devis?.rate ?? settings.rateHainautMin}">
          </div>
        </div>
      </div>

      <div id="panel-fields" style="display:none">
        <div class="grid-2">
          <div class="field">
            <label>Nombre de panneaux</label>
            <input type="number" step="1" min="0" name="panelCount" id="panel-input" value="${devis?.panelCount ?? 0}">
          </div>
          <div class="field">
            <label>Eau osmosée (forfait €)</label>
            <input type="number" step="any" min="0" name="osmosisWaterFee" id="osmosis-input" value="${devis?.osmosisWaterFee ?? settings.osmosisWaterFee}">
          </div>
        </div>
        <p class="muted" id="panel-hint"></p>
      </div>

      <div id="grille-fields" style="display:none">
        <div class="field">
          <label>Catégorie de maison</label>
          <select id="tier-select">
            ${Object.entries(tiers).map(([key, t]) => `<option value="${key}" ${devis?.tier === key ? "selected" : ""}>${t.label}</option>`).join("")}
          </select>
          <p class="muted" id="tier-hint"></p>
        </div>
        <div id="tier-normal-fields">
          <div class="grid-2">
            <div class="field">
              <label>Formule</label>
              <select id="tier-formule-select">
                <option value="ext" ${devis?.tierFormule === "ext" ? "selected" : ""}>${FORMULE_LABELS.ext}</option>
                <option value="full" ${devis?.tierFormule === "full" ? "selected" : ""}>${FORMULE_LABELS.full}</option>
              </select>
            </div>
            <div class="field">
              <label>Type de passage</label>
              <select id="tier-type-select">
                <option value="ponctuel" ${devis?.tierType === "ponctuel" ? "selected" : ""}>${TYPE_LABELS.ponctuel}</option>
                <option value="abonnement" ${devis?.tierType === "abonnement" ? "selected" : ""}>${TYPE_LABELS.abonnement}</option>
              </select>
            </div>
          </div>
        </div>
        <div class="field">
          <label>Prix retenu (€)</label>
          <input type="number" step="any" min="0" id="tier-price-input" value="${devis?.tierPrice ?? ""}">
          <p class="muted" id="tier-range-hint"></p>
        </div>
        <div id="tier-surcharges">
          ${Object.entries(surcharges).map(([key, s]) => {
            const chosen = devis?.surcharges?.find((x) => x.key === key);
            return `
            <div class="checkbox-row">
              <input type="checkbox" id="surcharge-${key}" ${chosen ? "checked" : ""}>
              <label for="surcharge-${key}" style="margin:0;font-weight:400;flex:1;color:var(--text)">${s.label} (+${fmtRange(s)})</label>
              <input type="number" step="any" min="0" id="surcharge-amount-${key}" value="${chosen ? chosen.amount : s.min}" style="width:80px;margin:0;${chosen ? "" : "display:none"}">
            </div>
          `;
          }).join("")}
        </div>
      </div>

      <div class="field">
        <label>Distance depuis Gerpinnes, aller simple (km)</label>
        <input type="number" step="0.1" min="0" name="travelKm" id="travel-input" value="${devis?.travelKm ?? 0}">
        <p class="muted" id="travel-hint">Frais de déplacement calculés en aller-retour à ${settings.travelFeePerKm} €/km.</p>
      </div>

      <div class="field">
        <label>Photos</label>
        <input type="file" accept="image/*" capture="environment" id="photo-input" multiple style="display:none">
        <button type="button" class="btn secondary" id="add-photo-btn">📷 Ajouter une photo</button>
        <div id="photo-grid" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"></div>
      </div>

      <div class="field">
        <label>Notes / description pour le client</label>
        <textarea name="notes" rows="3">${escapeHtml(devis?.notes || "")}</textarea>
      </div>

      <div class="field">
        <label>Statut</label>
        <select name="status">
          ${Object.entries(STATUS_LABELS).map(([k, l]) => `<option value="${k}" ${(devis?.status || "brouillon") === k ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>

      <div class="card" style="background:var(--teal-light);border:none;margin-top:6px">
        <div class="card-row"><span>Main d'œuvre</span><strong id="labor-out">—</strong></div>
        <div class="card-row"><span>Déplacement</span><strong id="travel-out">—</strong></div>
        <div class="card-row" style="margin-top:6px;border-top:1px solid var(--border);padding-top:6px">
          <span>Total</span><strong id="total-out" style="font-size:18px">—</strong>
        </div>
      </div>

      <button type="submit" class="btn block" style="margin-top:12px">Enregistrer le devis</button>
      ${devis ? `<button type="button" id="pdf-btn" class="btn secondary block" style="margin-top:10px">Générer le PDF</button>` : ""}
      ${devis ? `<button type="button" id="delete-btn" class="btn danger block" style="margin-top:10px">Supprimer</button>` : ""}
    </form>
  `;

  const form = container.querySelector("#devis-form");

  let photos = (devis?.photos || []).map((p) => ({ id: p.id, blob: p.blob, url: URL.createObjectURL(p.blob) }));

  function renderPhotoGrid() {
    const grid = container.querySelector("#photo-grid");
    if (photos.length === 0) {
      grid.innerHTML = `<p class="muted" style="margin:0">Aucune photo ajoutée.</p>`;
      return;
    }
    grid.innerHTML = photos.map((p) => `
      <div style="position:relative;width:72px;height:72px">
        <img src="${p.url}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;border:1px solid var(--border)">
        <button type="button" data-remove="${p.id}" style="position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;background:var(--danger);color:white;border:none;font-size:13px;line-height:1;padding:0">×</button>
      </div>
    `).join("");
    grid.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = photos.findIndex((p) => p.id === btn.dataset.remove);
        if (idx >= 0) {
          URL.revokeObjectURL(photos[idx].url);
          photos.splice(idx, 1);
          renderPhotoGrid();
        }
      });
    });
  }
  renderPhotoGrid();

  container.querySelector("#add-photo-btn").addEventListener("click", () => {
    container.querySelector("#photo-input").click();
  });
  container.querySelector("#photo-input").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    for (const file of files) {
      try {
        const blob = await resizeImage(file);
        photos.push({ id: uid(), blob, url: URL.createObjectURL(blob) });
      } catch {
        showToast("Impossible de charger cette photo");
      }
    }
    renderPhotoGrid();
  });

  const clientSelect = container.querySelector("#client-select");
  const manualNameField = container.querySelector("#manual-name-field");
  const serviceSelect = container.querySelector("#service-select");
  const pricingModeField = container.querySelector("#pricing-mode-field");
  const pricingModeSelect = container.querySelector("#pricing-mode-select");
  const regionField = container.querySelector("#region-field");
  const regionSelect = container.querySelector("#region-select");
  const hourlyFields = container.querySelector("#hourly-fields");
  const panelFields = container.querySelector("#panel-fields");
  const grilleFields = container.querySelector("#grille-fields");
  const tierNormalFields = container.querySelector("#tier-normal-fields");
  const tierSelect = container.querySelector("#tier-select");
  const tierFormuleSelect = container.querySelector("#tier-formule-select");
  const tierTypeSelect = container.querySelector("#tier-type-select");
  const tierPriceInput = container.querySelector("#tier-price-input");
  const tierRangeHint = container.querySelector("#tier-range-hint");
  const tierHint = container.querySelector("#tier-hint");
  const rateInput = container.querySelector("#rate-input");

  function currentMode() {
    if (serviceSelect.value === "panneaux") return "panneaux";
    if (serviceSelect.value === "vitres" && pricingModeSelect.value === "grille") return "grille";
    return "horaire";
  }

  function updateTierPriceSuggestion(forceOverwrite) {
    const tierKey = tierSelect.value;
    const t = tiers[tierKey];
    tierHint.textContent = t.hint || "";
    if (tierKey === "tresGrande") {
      tierNormalFields.style.display = "none";
      tierRangeHint.textContent = `Cas spécial, sur devis uniquement — à partir de ${t.startingAt} €.`;
      if (forceOverwrite || !tierPriceInput.value) tierPriceInput.value = t.startingAt;
      return;
    }
    tierNormalFields.style.display = "";
    const formule = tierFormuleSelect.value;
    const type = tierTypeSelect.value;
    const range = type === "abonnement" ? (formule === "full" ? t.subFull : t.subExt) : (formule === "full" ? t.full : t.ext);
    const freqNote = type === "abonnement" && t.subFrequency ? ` (${t.subFrequency})` : "";
    tierRangeHint.textContent = `Fourchette conseillée : ${fmtRange(range)}${freqNote}`;
    if (forceOverwrite) {
      tierPriceInput.value = Math.round((range.min + range.max) / 2);
    }
  }

  function surchargesTotal() {
    let sum = 0;
    const chosen = [];
    Object.entries(surcharges).forEach(([key, s]) => {
      const checkbox = container.querySelector(`#surcharge-${key}`);
      const amountInput = container.querySelector(`#surcharge-amount-${key}`);
      amountInput.style.display = checkbox.checked ? "" : "none";
      if (checkbox.checked) {
        const amount = parseFloat(amountInput.value) || 0;
        sum += amount;
        chosen.push({ key, label: s.label, amount });
      }
    });
    return { sum, chosen };
  }

  function recompute() {
    const mode = currentMode();
    pricingModeField.style.display = serviceSelect.value === "vitres" ? "" : "none";
    const showHourly = mode === "horaire";
    const showGrille = mode === "grille";
    const showPanels = mode === "panneaux";
    regionField.style.display = showHourly ? "" : "none";
    hourlyFields.style.display = showHourly ? "" : "none";
    grilleFields.style.display = showGrille ? "" : "none";
    panelFields.style.display = showPanels ? "" : "none";

    let labor = 0;
    if (showPanels) {
      const count = parseFloat(container.querySelector("#panel-input").value) || 0;
      const osmosis = parseFloat(container.querySelector("#osmosis-input").value) || 0;
      labor = count * settings.solarPanelPrice + osmosis;
      container.querySelector("#panel-hint").textContent = `${settings.solarPanelPrice} €/panneau × ${count} + ${fmtEuro(osmosis)} d'eau osmosée`;
    } else if (showGrille) {
      const base = parseFloat(tierPriceInput.value) || 0;
      const { sum } = surchargesTotal();
      labor = base + sum;
    } else {
      const hours = parseFloat(container.querySelector("#hours-input").value) || 0;
      const rate = parseFloat(rateInput.value) || 0;
      labor = hours * rate;
    }

    const km = parseFloat(container.querySelector("#travel-input").value) || 0;
    const travelFee = km * 2 * settings.travelFeePerKm;

    container.querySelector("#labor-out").textContent = fmtEuro(labor);
    container.querySelector("#travel-out").textContent = fmtEuro(travelFee);
    container.querySelector("#total-out").textContent = fmtEuro(labor + travelFee);

    return { labor, travelFee, total: labor + travelFee };
  }

  function applyRegionDefaults() {
    const [min] = regionRateRange(regionSelect.value, settings);
    if (!devis) rateInput.value = min;
    recompute();
  }

  clientSelect.addEventListener("change", () => {
    manualNameField.style.display = clientSelect.value ? "none" : "";
    const c = clients.find((c) => c.id === clientSelect.value);
    if (c) {
      regionSelect.value = classifyRegion(c.postalCode);
      const base = settings.baseLat != null ? { lat: settings.baseLat, lng: settings.baseLng } : null;
      const dest = c.lat != null ? { lat: c.lat, lng: c.lng } : null;
      const dist = haversineKm(base, dest);
      if (dist != null) container.querySelector("#travel-input").value = Math.round(dist * 10) / 10;
      applyRegionDefaults();
    }
  });

  serviceSelect.addEventListener("change", () => {
    if (serviceSelect.value === "vitres" && !devis) updateTierPriceSuggestion(true);
    recompute();
  });
  pricingModeSelect.addEventListener("change", () => {
    if (!devis) updateTierPriceSuggestion(true);
    recompute();
  });
  tierSelect.addEventListener("change", () => {
    updateTierPriceSuggestion(!devis);
    recompute();
  });
  tierFormuleSelect.addEventListener("change", () => {
    updateTierPriceSuggestion(!devis);
    recompute();
  });
  tierTypeSelect.addEventListener("change", () => {
    updateTierPriceSuggestion(!devis);
    recompute();
  });
  Object.keys(surcharges).forEach((key) => {
    container.querySelector(`#surcharge-${key}`).addEventListener("change", recompute);
  });

  regionSelect.addEventListener("change", applyRegionDefaults);
  form.addEventListener("input", recompute);

  if (!devis) updateTierPriceSuggestion(true);
  else updateTierPriceSuggestion(false);
  recompute();

  container.querySelector("#back-btn").addEventListener("click", () => {
    location.hash = "#/devis";
  });

  if (devis) {
    container.querySelector("#delete-btn").addEventListener("click", async () => {
      if (confirm("Supprimer ce devis ?")) {
        await Store.delete("devis", devis.id);
        showToast("Devis supprimé");
        location.hash = "#/devis";
      }
    });
    container.querySelector("#pdf-btn").addEventListener("click", () => {
      generatePdf(devis, settings).catch(() => showToast("Erreur lors de la génération du PDF"));
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const mode = currentMode();
    const totals = recompute();
    const client = clients.find((c) => c.id === fd.get("clientId"));
    const { chosen: chosenSurcharges } = surchargesTotal();

    const record = {
      id: devis?.id,
      date: devis?.date || new Date().toISOString().slice(0, 10),
      clientId: fd.get("clientId") || null,
      clientName: client ? client.name : fd.get("clientName")?.trim() || "Client",
      clientAddress: client ? `${client.address}, ${client.postalCode} ${client.city}` : "",
      serviceType: fd.get("serviceType"),
      pricingMode: fd.get("serviceType") === "vitres" ? mode : null,
      region: fd.get("region"),
      hours: mode === "horaire" ? parseFloat(fd.get("hours")) || 0 : null,
      rate: mode === "horaire" ? parseFloat(fd.get("rate")) || 0 : null,
      panelCount: mode === "panneaux" ? parseFloat(fd.get("panelCount")) || 0 : null,
      osmosisWaterFee: mode === "panneaux" ? parseFloat(fd.get("osmosisWaterFee")) || 0 : null,
      tier: mode === "grille" ? tierSelect.value : null,
      tierFormule: mode === "grille" && tierSelect.value !== "tresGrande" ? tierFormuleSelect.value : null,
      tierType: mode === "grille" && tierSelect.value !== "tresGrande" ? tierTypeSelect.value : null,
      tierPrice: mode === "grille" ? parseFloat(tierPriceInput.value) || 0 : null,
      surcharges: mode === "grille" ? chosenSurcharges : [],
      travelKm: parseFloat(fd.get("travelKm")) || 0,
      travelFee: totals.travelFee,
      laborCost: totals.labor,
      total: totals.total,
      notes: fd.get("notes").trim(),
      status: fd.get("status"),
      photos: photos.map((p) => ({ id: p.id, blob: p.blob })),
    };
    const saved = await Store.put("devis", record);
    showToast("Devis enregistré");
    location.hash = `#/devis/${saved.id}`;
  });
}

async function generatePdf(devis, settings) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const marginX = 18;
  let y = 20;

  doc.setFontSize(20);
  doc.setTextColor(13, 110, 100);
  doc.text(settings.companyName, marginX, y);
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  y += 7;
  doc.text(`${settings.address}`, marginX, y);
  y += 5;
  doc.text(`${settings.postalCode} ${settings.city}, ${settings.country}`, marginX, y);

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(16);
  doc.text("DEVIS", 210 - marginX, 20, { align: "right" });
  doc.setFontSize(10);
  doc.text(`Date : ${devis.date}`, 210 - marginX, 27, { align: "right" });
  doc.text(`Réf : ${devis.id}`, 210 - marginX, 32, { align: "right" });

  y += 16;
  doc.setDrawColor(220, 220, 220);
  doc.line(marginX, y, 210 - marginX, y);
  y += 10;

  doc.setFontSize(11);
  doc.setTextColor(60, 60, 60);
  doc.text("Client", marginX, y);
  y += 6;
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(devis.clientName || "", marginX, y);
  if (devis.clientAddress) {
    y += 6;
    doc.setFontSize(10);
    doc.text(devis.clientAddress, marginX, y);
  }

  y += 14;
  doc.setFontSize(11);
  doc.setTextColor(60, 60, 60);
  doc.text("Prestation", marginX, y);
  y += 6;
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  let serviceLine = SERVICE_LABELS[devis.serviceType] || devis.serviceType;
  if (devis.pricingMode === "grille" && devis.tier) {
    const t = settings.windowTiers[devis.tier];
    serviceLine += ` — ${t.label}`;
    if (devis.tierFormule) serviceLine += `, ${FORMULE_LABELS[devis.tierFormule]}, ${TYPE_LABELS[devis.tierType]}`;
  }
  doc.text(serviceLine, marginX, y);

  if (devis.notes) {
    y += 7;
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    const lines = doc.splitTextToSize(devis.notes, 210 - marginX * 2);
    doc.text(lines, marginX, y);
    y += lines.length * 5;
  }

  y += 12;
  doc.setDrawColor(220, 220, 220);
  doc.line(marginX, y, 210 - marginX, y);
  y += 10;

  doc.setFontSize(11);
  const rows = [];
  if (devis.serviceType === "panneaux") {
    rows.push([`Nettoyage panneaux solaires (${devis.panelCount} × ${settings.solarPanelPrice} €)`, fmtEuro(devis.panelCount * settings.solarPanelPrice)]);
    rows.push(["Eau osmosée (forfait)", fmtEuro(devis.osmosisWaterFee)]);
  } else if (devis.pricingMode === "grille") {
    rows.push(["Forfait nettoyage vitres", fmtEuro(devis.tierPrice)]);
    (devis.surcharges || []).forEach((s) => rows.push([s.label, fmtEuro(s.amount)]));
  } else {
    rows.push([`Main d'œuvre (${devis.hours} h × ${devis.rate} €/h)`, fmtEuro(devis.laborCost)]);
  }
  if (devis.travelFee) {
    rows.push([`Déplacement (${devis.travelKm} km aller-retour × 2)`, fmtEuro(devis.travelFee)]);
  }

  rows.forEach(([label, amount]) => {
    doc.setTextColor(0, 0, 0);
    doc.text(label, marginX, y);
    doc.text(amount, 210 - marginX, y, { align: "right" });
    y += 8;
  });

  y += 4;
  doc.setDrawColor(13, 110, 100);
  doc.setLineWidth(0.6);
  doc.line(marginX, y, 210 - marginX, y);
  y += 10;

  doc.setFontSize(14);
  doc.setTextColor(13, 110, 100);
  doc.text("TOTAL", marginX, y);
  doc.text(fmtEuro(devis.total), 210 - marginX, y, { align: "right" });

  y += 20;
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text("Devis valable 30 jours à compter de la date d'émission.", marginX, y);

  if (devis.photos && devis.photos.length > 0) {
    doc.addPage();
    y = 20;
    doc.setFontSize(12);
    doc.setTextColor(13, 110, 100);
    doc.text("Photos", marginX, y);
    y += 10;

    const imgW = 80;
    const imgH = 60;
    const gap = 8;
    let col = 0;
    for (const photo of devis.photos) {
      if (y + imgH > 285) {
        doc.addPage();
        y = 20;
        col = 0;
      }
      const dataUrl = await blobToDataURL(photo.blob);
      const format = photo.blob.type && photo.blob.type.includes("png") ? "PNG" : "JPEG";
      const x = marginX + col * (imgW + gap);
      try {
        doc.addImage(dataUrl, format, x, y, imgW, imgH);
      } catch {
        // photo illisible, on l'ignore plutôt que de bloquer tout le PDF
      }
      if (col === 0) {
        col = 1;
      } else {
        col = 0;
        y += imgH + gap;
      }
    }
  }

  doc.save(`Devis_${(devis.clientName || "client").replace(/\s+/g, "_")}_${devis.date}.pdf`);
}
