import { getSettings } from "../db.js";
import { escapeHtml, showToast } from "../toast.js";
import { generateQrDataUrl } from "../qrcode.js";
import { buildEpcQrPayload } from "../paymentQr.js";

export async function render(container) {
  const settings = await getSettings();

  if (!settings.iban && !settings.googleReviewUrl) {
    container.innerHTML = `
      <h1>QR Code</h1>
      <div class="empty-state">
        <div class="big">🔳</div>
        <p>Renseignez votre IBAN ou votre lien d'avis Google dans Réglages pour générer des codes QR.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <h1>QR Code</h1>
    <p class="muted" style="margin-top:-10px">Choisissez le code à afficher au client</p>
    <div class="grid-2" id="qr-choice-row">
      ${settings.iban ? `<button type="button" class="btn block" data-choice="pay">💳 Code paiement</button>` : ""}
      ${settings.googleReviewUrl ? `<button type="button" class="btn secondary block" data-choice="review">⭐ Code avis Google</button>` : ""}
    </div>
    <div id="qr-zone" style="margin-top:16px"></div>
  `;

  const zone = container.querySelector("#qr-zone");

  container.querySelectorAll("[data-choice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.choice === "pay") renderPayChoice(zone, settings);
      else renderReviewChoice(zone, settings);
    });
  });

  // Un seul choix disponible : on l'affiche directement, pas besoin de cliquer.
  if (settings.iban && !settings.googleReviewUrl) renderPayChoice(zone, settings);
  else if (settings.googleReviewUrl && !settings.iban) renderReviewChoice(zone, settings);
}

function renderPayChoice(zone, settings) {
  zone.innerHTML = `
    <div class="card">
      <div class="field">
        <label>Montant à payer (€)</label>
        <input type="number" step="0.01" min="0" id="qr-amount-input" placeholder="Ex : 120">
      </div>
      <div style="text-align:center;margin-bottom:6px">
        <div id="pay-qr-preview" style="display:inline-block;padding:8px;background:white;border-radius:10px;border:1px solid var(--border)"></div>
        <p class="muted" style="margin:6px 0 0">💳 Payer par QR code</p>
        <p class="muted" style="margin:2px 0 0;font-size:11.5px">À scanner depuis l'appli bancaire du client (pas l'appareil photo)</p>
      </div>
      <div class="card-row" style="background:var(--fill);border-radius:var(--radius-sm);padding:9px 12px">
        <span class="muted" style="font-size:13px">IBAN : ${escapeHtml(settings.iban)}</span>
        <button type="button" class="btn secondary small" id="copy-iban-btn">Copier</button>
      </div>
    </div>
  `;

  async function renderPayQr(amount) {
    const preview = zone.querySelector("#pay-qr-preview");
    if (!preview) return;
    try {
      const payload = buildEpcQrPayload({
        bic: settings.bic,
        name: settings.companyName,
        iban: settings.iban,
        amount: amount || 0,
        remittance: `Paiement ${settings.companyName}`,
      });
      const dataUrl = await generateQrDataUrl(payload, 260);
      preview.innerHTML = `<img src="${dataUrl}" alt="QR de paiement" style="width:170px;height:170px;display:block">`;
    } catch {
      preview.innerHTML = `<p class="muted" style="margin:0">QR indisponible</p>`;
    }
  }

  renderPayQr(0);
  let qrDebounce;
  zone.querySelector("#qr-amount-input").addEventListener("input", (e) => {
    clearTimeout(qrDebounce);
    const val = parseFloat(e.target.value) || 0;
    qrDebounce = setTimeout(() => renderPayQr(val), 300);
  });
  zone.querySelector("#copy-iban-btn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(settings.iban.replace(/\s+/g, ""));
      showToast("IBAN copié");
    } catch {
      showToast("Impossible de copier — sélectionnez le texte manuellement");
    }
  });
}

function renderReviewChoice(zone, settings) {
  zone.innerHTML = `
    <div class="card" style="text-align:center">
      <div id="review-qr-preview" style="display:inline-block;padding:8px;background:white;border-radius:10px;border:1px solid var(--border)"></div>
      <p class="muted" style="margin:6px 0 0">⭐ Laisser un avis Google</p>
    </div>
  `;
  generateQrDataUrl(settings.googleReviewUrl, 260)
    .then((dataUrl) => {
      const preview = zone.querySelector("#review-qr-preview");
      if (preview) preview.innerHTML = `<img src="${dataUrl}" alt="QR avis Google" style="width:170px;height:170px;display:block">`;
    })
    .catch(() => {});
}
