import { Store } from "../db.js";
import { escapeHtml, showToast } from "../toast.js";
import { FUNCTIONS_BASE } from "../config.js";

export async function render(container) {
  const all = await Store.getAll("whatsappMessages");
  all.sort((a, b) => (b._syncedAt || 0) - (a._syncedAt || 0));
  const pending = all.filter((m) => m.status === "pending");
  const handled = all.filter((m) => m.status !== "pending");

  container.innerHTML = `
    <h1>WhatsApp</h1>
    <p class="muted" style="margin-top:-10px">Les demandes de devis reçoivent une réponse automatique. Les autres messages arrivent ici avec un brouillon — relisez, modifiez si besoin, puis envoyez.</p>

    ${pending.length === 0 ? `
      <div class="empty-state">
        <div class="big">💬</div>
        <p>Aucun message en attente.</p>
      </div>
    ` : `
      <div class="card" style="display:flex;flex-direction:column;gap:14px">
        ${pending.map((m) => `
          <div style="border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:12px" data-msg="${m.id}">
            <p class="muted" style="font-size:12px;margin:0 0 4px">${escapeHtml(m.profileName || m.from || "Numéro inconnu")}</p>
            <p style="margin:0 0 10px;white-space:pre-wrap">${escapeHtml(m.body || "")}</p>
            <textarea class="wa-draft" rows="3" style="width:100%">${escapeHtml(m.draftReply || "")}</textarea>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button type="button" class="btn block wa-send" data-id="${m.id}">Envoyer</button>
              <button type="button" class="btn block secondary wa-ignore" data-id="${m.id}">Ignorer</button>
            </div>
          </div>
        `).join("")}
      </div>
    `}

    ${handled.length > 0 ? `
      <p class="muted" style="font-size:12px;margin-top:16px">Traités récemment</p>
      <div class="card">
        ${handled.slice(0, 15).map((m) => `
          <div style="padding:8px 0;border-bottom:1px solid var(--border)">
            <p class="muted" style="font-size:12px;margin:0">${escapeHtml(m.profileName || m.from || "")} — ${m.status === "sent" ? (m.sentAuto ? "🤖 envoyé automatiquement" : "✅ envoyé") : "ignoré"}</p>
            <p style="margin:2px 0 0;font-size:14px">${escapeHtml(m.body || "")}</p>
          </div>
        `).join("")}
      </div>
    ` : ""}
  `;

  container.querySelectorAll(".wa-send").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const card = container.querySelector(`[data-msg="${id}"]`);
      const textarea = card.querySelector(".wa-draft");
      const finalText = textarea.value.trim();
      if (!finalText) {
        showToast("Le message est vide");
        return;
      }
      const msg = await Store.get("whatsappMessages", id);
      if (!msg) return;
      btn.disabled = true;
      btn.textContent = "Envoi...";
      try {
        const res = await fetch(`${FUNCTIONS_BASE}/whatsapp-send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: msg.from, body: finalText }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Échec de l'envoi");
        }
        await Store.put("whatsappMessages", { ...msg, status: "sent", sentBody: finalText, sentAt: Date.now() });
        showToast("Message envoyé");
        render(container);
      } catch (err) {
        showToast(err.message || "Échec de l'envoi");
        btn.disabled = false;
        btn.textContent = "Envoyer";
      }
    });
  });

  container.querySelectorAll(".wa-ignore").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const msg = await Store.get("whatsappMessages", id);
      if (!msg) return;
      await Store.put("whatsappMessages", { ...msg, status: "ignored" });
      showToast("Message ignoré");
      render(container);
    });
  });
}
