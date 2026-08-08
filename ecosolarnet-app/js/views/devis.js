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
const SERVICE_ORDER = Object.keys(SERVICE_LABELS);
const HOURLY_ONLY_TYPES = ["veranda", "pergola", "carport"];

const STATUS_LABELS = {
  brouillon: "Brouillon",
  envoye: "Envoyé",
  accepte: "Accepté",
};

const FORMULE_LABELS = { ext: "Extérieur", full: "Intérieur + extérieur" };
const TYPE_LABELS = { ponctuel: "Ponctuel", abonnement: "Abonnement" };
const FREQUENCY_LABELS = {
  hebdomadaire: "Hebdomadaire",
  mensuel: "Mensuel",
  bimestriel: "Bimestriel",
  trimestriel: "Trimestriel",
  semestriel: "Semestriel",
  annuel: "Annuel",
};

function fmtEuro(n) {
  return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",") + " €";
}

function fmtRange(range) {
  if (!range) return "";
  return range.min === range.max ? `${range.min} €` : `${range.min}–${range.max} €`;
}

// Compatibilité avec d'anciens devis enregistrés avant le passage au
// multi-prestations (ils avaient un seul serviceType à la racine).
function getServicesArray(d) {
  if (!d) return [];
  if (d.services) return d.services;
  if (!d.serviceType) return [];
  return [{
    serviceType: d.serviceType,
    pricingMode: d.pricingMode,
    hours: d.hours,
    rate: d.rate,
    panelCount: d.panelCount,
    panelPrice: d.panelPrice,
    osmosisWaterFee: d.osmosisWaterFee,
    tier: d.tier,
    tierFormule: d.tierFormule,
    tierType: d.tierType,
    tierPrice: d.tierPrice,
    surcharges: d.surcharges || [],
    lineTotal: d.laborCost,
  }];
}

function serviceLabelsLine(d) {
  return getServicesArray(d).map((s) => SERVICE_LABELS[s.serviceType] || s.serviceType).join(", ") || "—";
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

  const monthPrefix = new Date().toISOString().slice(0, 7);
  const caCeMois = devisList
    .filter((d) => (d.date || "").startsWith(monthPrefix) && d.status === "accepte")
    .reduce((s, d) => s + d.total, 0);

  container.innerHTML = `
    <h1>Devis</h1>
    <div class="stat-row" style="grid-template-columns:1fr">
      <div class="stat-card alt">
        <div class="num">${fmtEuro(caCeMois)}</div>
        <div class="label">Devis acceptés ce mois</div>
      </div>
    </div>
    ${devisList.length === 0 ? `
      <div class="empty-state">
        <div class="big">📄</div>
        <p>Aucun devis pour l'instant.<br>Maintenez le doigt sur "Devis" en bas de l'écran pour en créer un.</p>
      </div>
    ` : `
      <div class="card">
        ${devisList.map((d) => `
          <div class="list-item" data-id="${d.id}">
            <div>
              <div><strong>${escapeHtml(d.clientName || "Client")}</strong></div>
              <div class="muted">${escapeHtml(serviceLabelsLine(d))} · ${d.date}</div>
            </div>
            <div style="text-align:right">
              <div><strong>${fmtEuro(d.total)}</strong></div>
              <span class="badge-status badge-${d.status}">${STATUS_LABELS[d.status]}</span>
            </div>
          </div>
        `).join("")}
      </div>
    `}
  `;

  container.querySelectorAll(".list-item").forEach((el) => {
    el.addEventListener("click", () => {
      location.hash = `#/devis/${el.dataset.id}`;
    });
  });
}

function hourlyBlockHtml(type, svc, defaultRate) {
  const label = SERVICE_LABELS[type];
  return `
    <div class="card" id="svc-block-${type}" style="display:none;background:var(--fill);border:none">
      <h3 style="margin-top:0">${label}</h3>
      <div class="grid-2">
        <div class="field">
          <label>Heures estimées</label>
          <input type="number" step="any" min="0" id="${type}-hours-input" value="${svc?.hours ?? 1}">
        </div>
        <div class="field">
          <label>Taux horaire (€/h)</label>
          <input type="number" step="any" min="0" id="${type}-rate-input" value="${svc?.rate ?? defaultRate}">
        </div>
      </div>
      <div class="card-row"><span class="muted">Sous-total</span><strong id="${type}-subtotal">—</strong></div>
    </div>
  `;
}

function vitresBlockHtml(svc, settings) {
  const tiers = settings.windowTiers;
  const surcharges = settings.windowSurcharges;
  return `
    <div class="card" id="svc-block-vitres" style="display:none;background:var(--fill);border:none">
      <h3 style="margin-top:0">Nettoyage vitres</h3>
      <div class="field">
        <label>Mode de tarification</label>
        <select id="vitres-mode-select">
          <option value="grille" ${svc?.pricingMode !== "horaire" ? "selected" : ""}>Grille par taille de maison</option>
          <option value="horaire" ${svc?.pricingMode === "horaire" ? "selected" : ""}>Taux horaire</option>
        </select>
      </div>

      <div id="vitres-hourly-fields">
        <div class="grid-2">
          <div class="field">
            <label>Heures estimées</label>
            <input type="number" step="any" min="0" id="vitres-hours-input" value="${svc?.hours ?? 1}">
          </div>
          <div class="field">
            <label>Taux horaire (€/h)</label>
            <input type="number" step="any" min="0" id="vitres-rate-input" value="${svc?.rate ?? settings.rateHainautMin}">
          </div>
        </div>
      </div>

      <div id="vitres-grille-fields">
        <div class="field">
          <label>Catégorie de maison</label>
          <select id="vitres-tier-select">
            ${Object.entries(tiers).map(([key, t]) => `<option value="${key}" ${svc?.tier === key ? "selected" : ""}>${t.label}</option>`).join("")}
          </select>
          <p class="muted" id="vitres-tier-hint"></p>
        </div>
        <div id="vitres-tier-normal-fields">
          <div class="grid-2">
            <div class="field">
              <label>Formule</label>
              <select id="vitres-tier-formule-select">
                <option value="ext" ${svc?.tierFormule === "ext" ? "selected" : ""}>${FORMULE_LABELS.ext}</option>
                <option value="full" ${svc?.tierFormule === "full" ? "selected" : ""}>${FORMULE_LABELS.full}</option>
              </select>
            </div>
            <div class="field">
              <label>Type de passage</label>
              <select id="vitres-tier-type-select">
                <option value="ponctuel" ${svc?.tierType === "ponctuel" ? "selected" : ""}>${TYPE_LABELS.ponctuel}</option>
                <option value="abonnement" ${svc?.tierType === "abonnement" ? "selected" : ""}>${TYPE_LABELS.abonnement}</option>
              </select>
            </div>
          </div>
          <div class="field" id="vitres-frequency-field" style="display:none">
            <label>Fréquence</label>
            <select id="vitres-frequency-select">
              ${Object.entries(FREQUENCY_LABELS).map(([key, label]) => `<option value="${key}" ${(svc?.frequency || "mensuel") === key ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field">
          <label>Prix retenu (€)</label>
          <input type="number" step="any" min="0" id="vitres-tier-price-input" value="${svc?.tierPrice ?? ""}">
          <p class="muted" id="vitres-tier-range-hint"></p>
        </div>
        <div id="vitres-surcharges">
          ${Object.entries(surcharges).map(([key, s]) => {
            const chosen = svc?.surcharges?.find((x) => x.key === key);
            return `
            <div class="checkbox-row">
              <input type="checkbox" id="vitres-surcharge-${key}" ${chosen ? "checked" : ""}>
              <label for="vitres-surcharge-${key}" style="margin:0;font-weight:400;flex:1;color:var(--text)">${s.label} (+${fmtRange(s)})</label>
              <input type="number" step="any" min="0" id="vitres-surcharge-amount-${key}" value="${chosen ? chosen.amount : s.min}" style="width:80px;margin:0;${chosen ? "" : "display:none"}">
            </div>
          `;
          }).join("")}
        </div>
      </div>
      <div class="card-row"><span class="muted">Sous-total</span><strong id="vitres-subtotal">—</strong></div>
    </div>
  `;
}

function panneauxBlockHtml(svc, settings) {
  return `
    <div class="card" id="svc-block-panneaux" style="display:none;background:var(--fill);border:none">
      <h3 style="margin-top:0">Nettoyage panneaux solaires</h3>
      <div class="grid-2">
        <div class="field">
          <label>Nombre de panneaux</label>
          <input type="number" step="1" min="0" id="panneaux-count-input" value="${svc?.panelCount ?? 0}">
        </div>
        <div class="field">
          <label>Eau osmosée (forfait €)</label>
          <input type="number" step="any" min="0" id="panneaux-osmosis-input" value="${svc?.osmosisWaterFee ?? settings.osmosisWaterFee}">
        </div>
      </div>
      <div class="field">
        <label>Prix par panneau — glissez pour ajuster selon la situation</label>
        <div class="slider-wrapper">
          <div class="slider-bubble" id="panneaux-price-bubble">0 €</div>
          <input type="range" id="panneaux-price-slider" min="2" max="15" step="0.5" value="${svc?.panelPrice ?? settings.solarPanelPrice}">
        </div>
        <div class="card-row" style="margin-top:0">
          <span class="muted" style="font-size:11px">2 €</span>
          <span class="muted" style="font-size:11px">15 €</span>
        </div>
      </div>
      <p class="muted" id="panneaux-hint"></p>
      <div class="card-row"><span class="muted">Sous-total</span><strong id="panneaux-subtotal">—</strong></div>
    </div>
  `;
}

async function renderForm(container, id) {
  const devis = id ? await Store.get("devis", id) : null;
  const settings = await getSettings();
  const clients = await Store.getAll("clients");
  clients.sort((a, b) => a.name.localeCompare(b.name));

  const existingServices = getServicesArray(devis);
  const svcByType = Object.fromEntries(existingServices.map((s) => [s.serviceType, s]));
  const checkedTypes = new Set(existingServices.map((s) => s.serviceType));

  const initialClient = devis?.clientId ? clients.find((c) => c.id === devis.clientId) : null;
  const initialRegion = svcByType.vitres?.region || svcByType.veranda?.region || (initialClient ? classifyRegion(initialClient.postalCode) : "Hainaut");
  const [defaultRate] = regionRateRange(initialRegion, settings);

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

      <label>Prestations * (choisissez-en une ou plusieurs)</label>
      <div class="field">
        ${SERVICE_ORDER.map((type) => `
          <div class="checkbox-row">
            <input type="checkbox" id="svc-check-${type}" ${checkedTypes.has(type) ? "checked" : ""}>
            <label for="svc-check-${type}" style="margin:0;font-weight:400;color:var(--text)">${SERVICE_LABELS[type]}</label>
          </div>
        `).join("")}
      </div>

      <div class="field" id="region-field">
        <label>Région (taux horaire)</label>
        <select id="region-select">
          <option value="Hainaut" ${initialRegion === "Hainaut" ? "selected" : ""}>Hainaut (${settings.rateHainautMin}-${settings.rateHainautMax} €/h)</option>
          <option value="Bruxelles" ${initialRegion === "Bruxelles" ? "selected" : ""}>Bruxelles (${settings.rateBruxellesMin}-${settings.rateBruxellesMax} €/h)</option>
        </select>
      </div>

      ${vitresBlockHtml(svcByType.vitres, settings)}
      ${HOURLY_ONLY_TYPES.map((type) => hourlyBlockHtml(type, svcByType[type], defaultRate)).join("")}
      ${panneauxBlockHtml(svcByType.panneaux, settings)}

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
        <label>Type de client</label>
        <select name="clientType">
          <option value="particulier" ${(devis?.clientType || "particulier") === "particulier" ? "selected" : ""}>Particulier (TVA 21% ajoutée)</option>
          <option value="professionnel" ${devis?.clientType === "professionnel" ? "selected" : ""}>Professionnel (reste HTVA)</option>
        </select>
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
  const regionField = container.querySelector("#region-field");
  const regionSelect = container.querySelector("#region-select");
  const travelInput = container.querySelector("#travel-input");

  const vitresModeSelect = container.querySelector("#vitres-mode-select");
  const vitresHourlyFields = container.querySelector("#vitres-hourly-fields");
  const vitresGrilleFields = container.querySelector("#vitres-grille-fields");
  const vitresTierSelect = container.querySelector("#vitres-tier-select");
  const vitresTierNormalFields = container.querySelector("#vitres-tier-normal-fields");
  const vitresTierFormuleSelect = container.querySelector("#vitres-tier-formule-select");
  const vitresTierTypeSelect = container.querySelector("#vitres-tier-type-select");
  const vitresFrequencyField = container.querySelector("#vitres-frequency-field");
  const vitresFrequencySelect = container.querySelector("#vitres-frequency-select");
  const vitresTierPriceInput = container.querySelector("#vitres-tier-price-input");
  const vitresTierRangeHint = container.querySelector("#vitres-tier-range-hint");
  const vitresTierHint = container.querySelector("#vitres-tier-hint");
  const vitresRateInput = container.querySelector("#vitres-rate-input");

  const panneauxPriceSlider = container.querySelector("#panneaux-price-slider");
  const panneauxPriceBubble = container.querySelector("#panneaux-price-bubble");

  const tiers = settings.windowTiers;
  const surcharges = settings.windowSurcharges;

  function isChecked(type) {
    return container.querySelector(`#svc-check-${type}`).checked;
  }

  function updateVitresVisibility() {
    const showGrille = vitresModeSelect.value === "grille";
    vitresHourlyFields.style.display = showGrille ? "none" : "";
    vitresGrilleFields.style.display = showGrille ? "" : "none";
  }

  function updateVitresTierSuggestion(forceOverwrite) {
    const tierKey = vitresTierSelect.value;
    const t = tiers[tierKey];
    vitresTierHint.textContent = t.hint || "";
    if (tierKey === "tresGrande") {
      vitresTierNormalFields.style.display = "none";
      vitresTierRangeHint.textContent = `Cas spécial, sur devis uniquement — à partir de ${t.startingAt} €.`;
      if (forceOverwrite || !vitresTierPriceInput.value) vitresTierPriceInput.value = t.startingAt;
      return;
    }
    vitresTierNormalFields.style.display = "";
    const formule = vitresTierFormuleSelect.value;
    const type = vitresTierTypeSelect.value;
    vitresFrequencyField.style.display = type === "abonnement" ? "" : "none";
    const range = type === "abonnement" ? (formule === "full" ? t.subFull : t.subExt) : (formule === "full" ? t.full : t.ext);
    const freqNote = type === "abonnement" && t.subFrequency ? ` (${t.subFrequency})` : "";
    vitresTierRangeHint.textContent = `Fourchette conseillée : ${fmtRange(range)}${freqNote}`;
    if (forceOverwrite) {
      vitresTierPriceInput.value = Math.round((range.min + range.max) / 2);
    }
  }

  function vitresSurchargesTotal() {
    let sum = 0;
    const chosen = [];
    Object.entries(surcharges).forEach(([key, s]) => {
      const checkbox = container.querySelector(`#vitres-surcharge-${key}`);
      const amountInput = container.querySelector(`#vitres-surcharge-amount-${key}`);
      amountInput.style.display = checkbox.checked ? "" : "none";
      if (checkbox.checked) {
        const amount = parseFloat(amountInput.value) || 0;
        sum += amount;
        chosen.push({ key, label: s.label, amount });
      }
    });
    return { sum, chosen };
  }

  function updatePanneauxPriceBubble() {
    const min = parseFloat(panneauxPriceSlider.min);
    const max = parseFloat(panneauxPriceSlider.max);
    const val = parseFloat(panneauxPriceSlider.value);
    const pct = (val - min) / (max - min);
    const sliderWidth = panneauxPriceSlider.offsetWidth;
    const thumbWidth = 20;
    const x = pct * (sliderWidth - thumbWidth) + thumbWidth / 2;
    panneauxPriceBubble.style.left = `${x}px`;
    panneauxPriceBubble.textContent = `${val} €/panneau`;
  }

  function computeVitresLine() {
    if (vitresModeSelect.value === "grille") {
      const base = parseFloat(vitresTierPriceInput.value) || 0;
      const { sum, chosen } = vitresSurchargesTotal();
      return {
        total: base + sum,
        detail: {
          pricingMode: "grille",
          tier: vitresTierSelect.value,
          tierFormule: vitresTierSelect.value !== "tresGrande" ? vitresTierFormuleSelect.value : null,
          tierType: vitresTierSelect.value !== "tresGrande" ? vitresTierTypeSelect.value : null,
          frequency: vitresTierSelect.value !== "tresGrande" && vitresTierTypeSelect.value === "abonnement" ? vitresFrequencySelect.value : null,
          tierPrice: base,
          surcharges: chosen,
        },
      };
    }
    const hours = parseFloat(vitresHourlyFields.querySelector("#vitres-hours-input").value) || 0;
    const rate = parseFloat(vitresRateInput.value) || 0;
    return { total: hours * rate, detail: { pricingMode: "horaire", hours, rate } };
  }

  function computeHourlyLine(type) {
    const hours = parseFloat(container.querySelector(`#${type}-hours-input`).value) || 0;
    const rate = parseFloat(container.querySelector(`#${type}-rate-input`).value) || 0;
    return { total: hours * rate, detail: { hours, rate } };
  }

  function computePanneauxLine() {
    const count = parseFloat(container.querySelector("#panneaux-count-input").value) || 0;
    const price = parseFloat(panneauxPriceSlider.value) || 0;
    const osmosis = parseFloat(container.querySelector("#panneaux-osmosis-input").value) || 0;
    updatePanneauxPriceBubble();
    container.querySelector("#panneaux-hint").textContent = `${price} €/panneau × ${count} + ${fmtEuro(osmosis)} d'eau osmosée`;
    return { total: count * price + osmosis, detail: { panelCount: count, panelPrice: price, osmosisWaterFee: osmosis } };
  }

  function recompute() {
    let labor = 0;
    const lineResults = {};
    let anyHourly = false;

    for (const type of SERVICE_ORDER) {
      const block = container.querySelector(`#svc-block-${type}`);
      const checked = isChecked(type);
      block.style.display = checked ? "" : "none";
      if (!checked) continue;

      let result;
      if (type === "vitres") {
        result = computeVitresLine();
        if (result.detail.pricingMode === "horaire") anyHourly = true;
      } else if (type === "panneaux") {
        result = computePanneauxLine();
      } else {
        result = computeHourlyLine(type);
        anyHourly = true;
      }
      lineResults[type] = result;
      labor += result.total;
      const subtotalEl = container.querySelector(`#${type}-subtotal`);
      if (subtotalEl) subtotalEl.textContent = fmtEuro(result.total);
    }

    regionField.style.display = anyHourly ? "" : "none";

    const km = parseFloat(travelInput.value) || 0;
    const travelFee = km * 2 * settings.travelFeePerKm;

    container.querySelector("#labor-out").textContent = fmtEuro(labor);
    container.querySelector("#travel-out").textContent = fmtEuro(travelFee);
    container.querySelector("#total-out").textContent = fmtEuro(labor + travelFee);

    return { labor, travelFee, total: labor + travelFee, lineResults };
  }

  function applyRegionDefaults() {
    const [min] = regionRateRange(regionSelect.value, settings);
    if (!devis) {
      if (!isChecked("vitres") || vitresModeSelect.value === "horaire") {
        const el = container.querySelector("#vitres-rate-input");
        if (el) el.value = min;
      }
      HOURLY_ONLY_TYPES.forEach((type) => {
        const el = container.querySelector(`#${type}-rate-input`);
        if (el) el.value = min;
      });
    }
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
      if (dist != null) travelInput.value = Math.round(dist * 10) / 10;
      applyRegionDefaults();
    }
  });

  SERVICE_ORDER.forEach((type) => {
    container.querySelector(`#svc-check-${type}`).addEventListener("change", () => recompute());
  });

  vitresModeSelect.addEventListener("change", () => {
    updateVitresVisibility();
    if (!devis) updateVitresTierSuggestion(true);
    recompute();
  });
  vitresTierSelect.addEventListener("change", () => {
    updateVitresTierSuggestion(!devis);
    recompute();
  });
  vitresTierFormuleSelect.addEventListener("change", () => {
    updateVitresTierSuggestion(!devis);
    recompute();
  });
  vitresTierTypeSelect.addEventListener("change", () => {
    updateVitresTierSuggestion(!devis);
    recompute();
  });
  Object.keys(surcharges).forEach((key) => {
    container.querySelector(`#vitres-surcharge-${key}`).addEventListener("change", recompute);
  });

  regionSelect.addEventListener("change", applyRegionDefaults);
  form.addEventListener("input", recompute);

  updateVitresVisibility();
  if (!devis) updateVitresTierSuggestion(true);
  else updateVitresTierSuggestion(false);
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
    const totals = recompute();
    const client = clients.find((c) => c.id === fd.get("clientId"));

    const services = SERVICE_ORDER.filter((type) => isChecked(type)).map((type) => ({
      serviceType: type,
      lineTotal: totals.lineResults[type].total,
      ...totals.lineResults[type].detail,
    }));

    if (services.length === 0) {
      showToast("Sélectionnez au moins une prestation");
      return;
    }

    const record = {
      id: devis?.id,
      date: devis?.date || new Date().toISOString().slice(0, 10),
      clientId: fd.get("clientId") || null,
      clientName: client ? client.name : fd.get("clientName")?.trim() || "Client",
      clientAddress: client ? `${client.address}, ${client.postalCode} ${client.city}` : "",
      services,
      region: regionSelect.value,
      travelKm: parseFloat(fd.get("travelKm")) || 0,
      travelFee: totals.travelFee,
      laborCost: totals.labor,
      total: totals.total,
      notes: fd.get("notes").trim(),
      status: fd.get("status"),
      clientType: fd.get("clientType") || "particulier",
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

  const servicesArr = getServicesArray(devis);

  y += 14;
  doc.setFontSize(11);
  doc.setTextColor(60, 60, 60);
  doc.text("Prestations", marginX, y);
  y += 6;
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  const serviceLine = servicesArr.map((s) => SERVICE_LABELS[s.serviceType] || s.serviceType).join(", ");
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
  for (const svc of servicesArr) {
    const label = SERVICE_LABELS[svc.serviceType] || svc.serviceType;
    if (svc.serviceType === "panneaux") {
      const panelPrice = svc.panelPrice ?? settings.solarPanelPrice;
      rows.push([`${label} (${svc.panelCount} × ${panelPrice} €)`, fmtEuro(svc.panelCount * panelPrice)]);
      rows.push(["Eau osmosée (forfait)", fmtEuro(svc.osmosisWaterFee)]);
    } else if (svc.pricingMode === "grille") {
      let desc = svc.tierFormule
        ? `${label} ${svc.tierFormule === "full" ? "intérieur et extérieur" : "extérieur"}`
        : label;
      if (svc.frequency) desc += ` ${svc.frequency}`;
      if (devis.travelFee) desc += " (frais de déplacement inclus)";
      const surchargesTotal = (svc.surcharges || []).reduce((s, sc) => s + (sc.amount || 0), 0);
      rows.push([desc, fmtEuro((svc.tierPrice || 0) + surchargesTotal)]);
    } else {
      rows.push([`${label} (${svc.hours} h × ${svc.rate} €/h)`, fmtEuro((svc.hours || 0) * (svc.rate || 0))]);
    }
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

  const isProfessional = devis.clientType === "professionnel";
  const totalHtva = devis.total || 0;
  const totalPayable = isProfessional ? totalHtva : totalHtva * 1.21;

  doc.setFontSize(isProfessional ? 14 : 11);
  doc.setTextColor(...(isProfessional ? [13, 110, 100] : [90, 90, 90]));
  doc.text("Total HTVA", marginX, y);
  doc.text(fmtEuro(totalHtva), 210 - marginX, y, { align: "right" });

  if (!isProfessional) {
    y += 9;
    doc.setFontSize(14);
    doc.setTextColor(13, 110, 100);
    doc.text("Total TVAC (21%)", marginX, y);
    doc.text(fmtEuro(totalPayable), 210 - marginX, y, { align: "right" });
  }

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
