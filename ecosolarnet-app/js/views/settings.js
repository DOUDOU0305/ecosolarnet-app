import { getSettings, saveSettings } from "../db.js";
import { geocodeAddress, fullAddress } from "../geo.js";
import { showToast } from "../toast.js";

function tierFieldsHtml(key, t) {
  if (key === "tresGrande") {
    return `
      <div class="field">
        <label>${t.label}</label>
        <p class="muted" style="margin-top:0">${t.hint}</p>
        <label>À partir de (€)</label>
        <input type="number" name="tier_${key}_startingAt" value="${t.startingAt}">
      </div>
    `;
  }
  return `
    <div class="field">
      <label>${t.label}</label>
      <p class="muted" style="margin-top:0">${t.hint}</p>
    </div>
    <label>Extérieur seul, ponctuel (€)</label>
    <div class="grid-2">
      <div class="field"><input type="number" name="tier_${key}_extMin" value="${t.ext.min}" placeholder="Min"></div>
      <div class="field"><input type="number" name="tier_${key}_extMax" value="${t.ext.max}" placeholder="Max"></div>
    </div>
    <label>Intérieur + extérieur, ponctuel (€)</label>
    <div class="grid-2">
      <div class="field"><input type="number" name="tier_${key}_fullMin" value="${t.full.min}" placeholder="Min"></div>
      <div class="field"><input type="number" name="tier_${key}_fullMax" value="${t.full.max}" placeholder="Max"></div>
    </div>
    <label>Extérieur, abonnement / passage (€)</label>
    <div class="grid-2">
      <div class="field"><input type="number" name="tier_${key}_subExtMin" value="${t.subExt.min}" placeholder="Min"></div>
      <div class="field"><input type="number" name="tier_${key}_subExtMax" value="${t.subExt.max}" placeholder="Max"></div>
    </div>
    <label>Complet, abonnement / passage (€)</label>
    <div class="grid-2">
      <div class="field"><input type="number" name="tier_${key}_subFullMin" value="${t.subFull.min}" placeholder="Min"></div>
      <div class="field"><input type="number" name="tier_${key}_subFullMax" value="${t.subFull.max}" placeholder="Max"></div>
    </div>
  `;
}

export async function render(container) {
  const s = await getSettings();

  container.innerHTML = `
    <h1>Réglages</h1>

    <form id="settings-form">
      <div class="card">
        <h3 style="margin-top:0">Entreprise</h3>
        <div class="field">
          <label>Nom de l'entreprise</label>
          <input name="companyName" value="${s.companyName}">
        </div>
        <div class="field">
          <label>Adresse (point de départ des tournées)</label>
          <input name="address" value="${s.address}">
        </div>
        <div class="grid-2">
          <div class="field">
            <label>Code postal</label>
            <input name="postalCode" value="${s.postalCode}">
          </div>
          <div class="field">
            <label>Ville</label>
            <input name="city" value="${s.city}">
          </div>
        </div>
        <p class="muted" id="geo-status">${s.baseLat != null ? "✅ Adresse localisée." : "⚠️ Adresse pas encore localisée — nécessaire pour calculer les distances."}</p>
      </div>

      <div class="card">
        <h3 style="margin-top:0">Tarifs horaires</h3>
        <label>Hainaut (€/h)</label>
        <div class="grid-2">
          <div class="field"><input type="number" name="rateHainautMin" value="${s.rateHainautMin}" placeholder="Min"></div>
          <div class="field"><input type="number" name="rateHainautMax" value="${s.rateHainautMax}" placeholder="Max"></div>
        </div>
        <label>Bruxelles (€/h)</label>
        <div class="grid-2">
          <div class="field"><input type="number" name="rateBruxellesMin" value="${s.rateBruxellesMin}" placeholder="Min"></div>
          <div class="field"><input type="number" name="rateBruxellesMax" value="${s.rateBruxellesMax}" placeholder="Max"></div>
        </div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">Déplacement</h3>
        <div class="field">
          <label>Frais de déplacement (€/km)</label>
          <input type="number" step="0.01" name="travelFeePerKm" value="${s.travelFeePerKm}">
        </div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">Grille tarifaire vitres (par taille de maison)</h3>
        <p class="muted">Utilisée quand vous choisissez "Grille par taille de maison" sur un devis vitres.</p>
        ${Object.entries(s.windowTiers).map(([key, t]) => `
          <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px">
            ${tierFieldsHtml(key, t)}
          </div>
        `).join("")}
      </div>

      <div class="card">
        <h3 style="margin-top:0">Suppléments vitres</h3>
        ${Object.entries(s.windowSurcharges).map(([key, sc]) => `
          <label>${sc.label} (€)</label>
          <div class="grid-2">
            <div class="field"><input type="number" name="surcharge_${key}_min" value="${sc.min}" placeholder="Min"></div>
            <div class="field"><input type="number" name="surcharge_${key}_max" value="${sc.max}" placeholder="Max"></div>
          </div>
        `).join("")}
      </div>

      <div class="card">
        <h3 style="margin-top:0">Panneaux solaires</h3>
        <div class="grid-2">
          <div class="field">
            <label>Prix par panneau (€)</label>
            <input type="number" name="solarPanelPrice" value="${s.solarPanelPrice}">
          </div>
          <div class="field">
            <label>Eau osmosée (forfait €)</label>
            <input type="number" name="osmosisWaterFee" value="${s.osmosisWaterFee}">
          </div>
        </div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">Tournées</h3>
        <div class="field">
          <label>Nombre maximum de clients par tournée</label>
          <input type="number" min="1" name="maxClientsPerDay" value="${s.maxClientsPerDay}">
        </div>
      </div>

      <button type="submit" class="btn block">Enregistrer les réglages</button>
    </form>

    <div class="card" style="margin-top:20px">
      <h3 style="margin-top:0">À propos</h3>
      <p class="muted">Application ECOSOLARNET — vos données (clients, devis, planning) sont stockées uniquement sur cet appareil, dans ce navigateur. Pensez à ne pas effacer les données de navigation de Safari pour cette appli.</p>
    </div>
  `;

  container.querySelector("#settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const patch = {};
    for (const [key, value] of fd.entries()) {
      if (key.startsWith("tier_") || key.startsWith("surcharge_")) continue;
      const numericKeys = ["rateHainautMin", "rateHainautMax", "rateBruxellesMin", "rateBruxellesMax", "travelFeePerKm", "solarPanelPrice", "osmosisWaterFee", "maxClientsPerDay"];
      patch[key] = numericKeys.includes(key) ? parseFloat(value) : value;
    }

    const windowTiers = {};
    for (const [key, t] of Object.entries(s.windowTiers)) {
      if (key === "tresGrande") {
        windowTiers[key] = { ...t, startingAt: parseFloat(fd.get(`tier_${key}_startingAt`)) || t.startingAt };
      } else {
        windowTiers[key] = {
          ...t,
          ext: { min: parseFloat(fd.get(`tier_${key}_extMin`)) || 0, max: parseFloat(fd.get(`tier_${key}_extMax`)) || 0 },
          full: { min: parseFloat(fd.get(`tier_${key}_fullMin`)) || 0, max: parseFloat(fd.get(`tier_${key}_fullMax`)) || 0 },
          subExt: { min: parseFloat(fd.get(`tier_${key}_subExtMin`)) || 0, max: parseFloat(fd.get(`tier_${key}_subExtMax`)) || 0 },
          subFull: { min: parseFloat(fd.get(`tier_${key}_subFullMin`)) || 0, max: parseFloat(fd.get(`tier_${key}_subFullMax`)) || 0 },
        };
      }
    }
    patch.windowTiers = windowTiers;

    const windowSurcharges = {};
    for (const [key, sc] of Object.entries(s.windowSurcharges)) {
      windowSurcharges[key] = {
        ...sc,
        min: parseFloat(fd.get(`surcharge_${key}_min`)) || 0,
        max: parseFloat(fd.get(`surcharge_${key}_max`)) || 0,
      };
    }
    patch.windowSurcharges = windowSurcharges;

    const saved = await saveSettings(patch);
    showToast("Réglages enregistrés");

    const status = container.querySelector("#geo-status");
    status.textContent = "Localisation de l'adresse en cours…";
    try {
      const coords = await geocodeAddress(fullAddress(saved));
      if (coords) {
        await saveSettings({ baseLat: coords.lat, baseLng: coords.lng });
        status.textContent = "✅ Adresse localisée.";
      } else {
        status.textContent = "⚠️ Adresse introuvable, vérifiez l'orthographe.";
      }
    } catch {
      status.textContent = "⚠️ Impossible de localiser l'adresse (pas de connexion internet ?).";
    }
  });
}
