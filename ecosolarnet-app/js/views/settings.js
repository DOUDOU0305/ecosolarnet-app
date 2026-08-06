import { getSettings, saveSettings } from "../db.js";
import { geocodeAddress, fullAddress } from "../geo.js";
import { showToast } from "../toast.js";
import { generateQrDataUrl } from "../qrcode.js";

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
        <h3 style="margin-top:0">Avis Google</h3>
        <p class="muted">Ce lien est intégré sous forme de code QR sur vos devis, pour que vos clients puissent laisser un avis facilement.</p>
        <div class="field">
          <label>Lien de l'avis Google</label>
          <input name="googleReviewUrl" id="google-review-url" value="${s.googleReviewUrl}" placeholder="https://g.page/r/....../review">
        </div>
        <div style="text-align:center;margin-top:10px">
          <div id="qr-preview" style="display:inline-block;padding:10px;background:white;border-radius:10px;border:1px solid var(--border)"></div>
          <p class="muted" style="margin:8px 0 0">Scannez pour tester, ou téléchargez pour l'imprimer</p>
          <a href="#" id="qr-download-link" download="ecosolarnet-avis-qr.png" class="btn secondary small" style="margin-top:8px;display:inline-block;text-decoration:none">Télécharger l'image</a>
        </div>
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
        <h3 style="margin-top:0">Ajuster rapidement les prix vitres</h3>
        <p class="muted">Augmente ou diminue tous les prix de la grille vitres et les suppléments, en une fois.</p>
        <input type="range" id="vitres-slider" min="-30" max="30" value="0" step="1" style="width:100%">
        <p class="muted" id="vitres-slider-label" style="text-align:center;font-size:16px;font-weight:600;color:var(--text);margin:6px 0">0 %</p>
        <button type="button" class="btn secondary block" id="vitres-apply-btn">Appliquer aux prix vitres</button>
      </div>

      <div class="card">
        <h3 style="margin-top:0">Ajuster rapidement le prix panneaux solaires</h3>
        <p class="muted">Augmente ou diminue le prix par panneau.</p>
        <input type="range" id="panneaux-slider" min="-30" max="30" value="0" step="1" style="width:100%">
        <p class="muted" id="panneaux-slider-label" style="text-align:center;font-size:16px;font-weight:600;color:var(--text);margin:6px 0">0 %</p>
        <button type="button" class="btn secondary block" id="panneaux-apply-btn">Appliquer au prix panneaux</button>
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

  async function refreshQrPreview(url) {
    const preview = container.querySelector("#qr-preview");
    const downloadLink = container.querySelector("#qr-download-link");
    if (!url) {
      preview.innerHTML = `<p class="muted" style="margin:0">Renseignez le lien ci-dessus</p>`;
      downloadLink.style.display = "none";
      return;
    }
    try {
      const dataUrl = await generateQrDataUrl(url, 260);
      preview.innerHTML = `<img src="${dataUrl}" alt="Code QR avis Google" style="width:180px;height:180px;display:block">`;
      downloadLink.href = dataUrl;
      downloadLink.style.display = "inline-block";
    } catch {
      preview.innerHTML = `<p class="muted" style="margin:0">Impossible de générer le code QR</p>`;
      downloadLink.style.display = "none";
    }
  }
  await refreshQrPreview(s.googleReviewUrl);

  let qrDebounce;
  container.querySelector("#google-review-url").addEventListener("input", (e) => {
    clearTimeout(qrDebounce);
    qrDebounce = setTimeout(() => refreshQrPreview(e.target.value.trim()), 500);
  });

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

  function wireSliderLabel(sliderId, labelId) {
    const slider = container.querySelector(`#${sliderId}`);
    const label = container.querySelector(`#${labelId}`);
    slider.addEventListener("input", () => {
      const v = parseInt(slider.value, 10);
      label.textContent = (v > 0 ? "+" : "") + v + " %";
    });
  }
  wireSliderLabel("vitres-slider", "vitres-slider-label");
  wireSliderLabel("panneaux-slider", "panneaux-slider-label");

  container.querySelector("#vitres-apply-btn").addEventListener("click", async () => {
    const pct = parseInt(container.querySelector("#vitres-slider").value, 10);
    if (!pct) {
      showToast("Déplacez le curseur pour choisir un ajustement");
      return;
    }
    const mult = 1 + pct / 100;
    const current = await getSettings();
    const newTiers = {};
    for (const [key, t] of Object.entries(current.windowTiers)) {
      if (key === "tresGrande") {
        newTiers[key] = { ...t, startingAt: Math.round(t.startingAt * mult) };
      } else {
        newTiers[key] = {
          ...t,
          ext: { min: Math.round(t.ext.min * mult), max: Math.round(t.ext.max * mult) },
          full: { min: Math.round(t.full.min * mult), max: Math.round(t.full.max * mult) },
          subExt: { min: Math.round(t.subExt.min * mult), max: Math.round(t.subExt.max * mult) },
          subFull: { min: Math.round(t.subFull.min * mult), max: Math.round(t.subFull.max * mult) },
        };
      }
    }
    const newSurcharges = {};
    for (const [key, sc] of Object.entries(current.windowSurcharges)) {
      newSurcharges[key] = { ...sc, min: Math.round(sc.min * mult), max: Math.round(sc.max * mult) };
    }
    await saveSettings({ windowTiers: newTiers, windowSurcharges: newSurcharges });
    showToast(`Prix vitres ajustés de ${pct > 0 ? "+" : ""}${pct}%`);
    await render(container);
  });

  container.querySelector("#panneaux-apply-btn").addEventListener("click", async () => {
    const pct = parseInt(container.querySelector("#panneaux-slider").value, 10);
    if (!pct) {
      showToast("Déplacez le curseur pour choisir un ajustement");
      return;
    }
    const mult = 1 + pct / 100;
    const current = await getSettings();
    await saveSettings({ solarPanelPrice: Math.round(current.solarPanelPrice * mult * 100) / 100 });
    showToast(`Prix panneaux ajusté de ${pct > 0 ? "+" : ""}${pct}%`);
    await render(container);
  });
}
