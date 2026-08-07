import { Store, getSettings } from "../db.js";
import { escapeHtml, showToast } from "../toast.js";
import { getAccessToken, isConnected, disconnect as gmailDisconnect } from "../gmailAuth.js";
import { listInboxMessages, getMessage, trashMessage, untrashMessage, sendReply, getProfile } from "../gmail.js";

const CATEGORY_LABELS = {
  devis: "Demande de devis",
  rendezvous: "Demande de rendez-vous",
  renseignement: "Demande de renseignement",
};

let busy = false;

export async function render(container) {
  await paint(container);
}

async function paint(container) {
  const connected = isConnected();
  const all = await Store.getAll("processedEmails");
  const trashed = all.filter((e) => e.decision === "trashed").sort((a, b) => b.processedAt - a.processedAt).slice(0, 15);
  const pending = all.filter((e) => e.decision === "pending").sort((a, b) => b.processedAt - a.processedAt);

  container.innerHTML = `
    <h1>Emails</h1>
    <p class="muted" style="margin-top:-10px">Tri automatique et brouillons de réponse</p>

    <div class="card">
      ${connected ? `
        <strong>Gmail connecté</strong>
        <p class="muted" id="connected-account" style="margin:2px 0 8px">Vérification du compte…</p>
        <p class="muted" style="margin:4px 0 12px">Les publicités et arnaques sont mises à la corbeille automatiquement. Les réponses aux demandes de devis, rendez-vous et renseignements sont préparées mais jamais envoyées sans votre accord.</p>
        <button type="button" class="btn block" id="scan-btn" ${busy ? "disabled" : ""}>${busy ? "Analyse en cours…" : "🔍 Analyser ma boîte"}</button>
        <button type="button" class="btn secondary block" id="disconnect-btn" style="margin-top:8px">Déconnecter Gmail</button>
      ` : `
        <strong>Connectez votre boîte Gmail</strong>
        <p class="muted" style="margin:6px 0 12px">ECOSOLARNET pourra repérer les publicités et arnaques, et préparer des brouillons de réponse pour les demandes de devis, rendez-vous et renseignements. Rien n'est jamais envoyé sans votre accord.</p>
        <button type="button" class="btn block" id="connect-btn">Connecter Gmail</button>
      `}
    </div>

    ${pending.length > 0 ? `
      <h2>✍️ Brouillons à valider (${pending.length})</h2>
      ${pending.map((e) => draftCardHtml(e)).join("")}
    ` : ""}

    ${trashed.length > 0 ? `
      <h2>🗑️ Récemment mis à la corbeille</h2>
      <div class="card">
        ${trashed.map((e) => `
          <div class="list-item">
            <div style="flex:1;min-width:0;margin-right:10px">
              <strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.subject || "(sans sujet)")}</strong>
              <span class="muted" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.from || "")}</span>
            </div>
            <button type="button" class="btn secondary small restore-btn" data-id="${e.id}">Restaurer</button>
          </div>
        `).join("")}
      </div>
    ` : ""}

    ${connected && pending.length === 0 && trashed.length === 0 ? `
      <div class="empty-state">
        <div class="big">📭</div>
        <p>Touchez "Analyser ma boîte" pour trier vos emails récents.</p>
      </div>
    ` : ""}
  `;

  wireEvents(container);

  if (connected) {
    const accountLine = container.querySelector("#connected-account");
    getAccessToken({ interactive: false })
      .then((token) => getProfile(token))
      .then((profile) => {
        if (accountLine) accountLine.textContent = `Compte : ${profile.emailAddress}`;
      })
      .catch(() => {
        if (accountLine) accountLine.textContent = "";
      });
  }
}

function draftCardHtml(e) {
  return `
    <div class="card" data-draft-id="${e.id}">
      <span class="pill" style="margin-bottom:8px;display:inline-block">${escapeHtml(CATEGORY_LABELS[e.category] || "Demande")}</span>
      <strong style="display:block;margin-bottom:2px">${escapeHtml(e.subject || "(sans sujet)")}</strong>
      <span class="muted" style="display:block;margin-bottom:10px">${escapeHtml(e.from || "")}</span>
      <label>Votre réponse (modifiable)</label>
      <textarea rows="6" class="draft-textarea">${escapeHtml(e.reply || "")}</textarea>
      <div class="grid-2" style="margin-top:4px">
        <button type="button" class="btn secondary ignore-btn" data-id="${e.id}">Ignorer</button>
        <button type="button" class="btn send-btn" data-id="${e.id}">✉️ Envoyer</button>
      </div>
    </div>
  `;
}

function wireEvents(container) {
  const connectBtn = container.querySelector("#connect-btn");
  if (connectBtn) {
    connectBtn.addEventListener("click", async () => {
      connectBtn.disabled = true;
      connectBtn.textContent = "Connexion…";
      try {
        await getAccessToken({ interactive: true });
        showToast("Gmail connecté");
        await runScan(container);
      } catch {
        showToast("Connexion annulée ou impossible");
        await paint(container);
      }
    });
  }

  const disconnectBtn = container.querySelector("#disconnect-btn");
  if (disconnectBtn) {
    disconnectBtn.addEventListener("click", async () => {
      gmailDisconnect();
      showToast("Gmail déconnecté");
      await paint(container);
    });
  }

  const scanBtn = container.querySelector("#scan-btn");
  if (scanBtn) {
    scanBtn.addEventListener("click", () => runScan(container));
  }

  container.querySelectorAll(".restore-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        const token = await getAccessToken({ interactive: false });
        await untrashMessage(token, id);
        await Store.delete("processedEmails", id);
        showToast("Email restauré dans la boîte de réception");
        await paint(container);
      } catch (err) {
        const message = err.message || String(err);
        if (message.includes("404")) {
          // Email supprimé définitivement (corbeille Gmail vidée) : plus rien à restaurer, on nettoie la ligne.
          await Store.delete("processedEmails", id);
          showToast("Cet email a été supprimé définitivement de Gmail, il ne peut plus être restauré");
          await paint(container);
        } else {
          showToast("Reconnectez Gmail puis réessayez (" + message + ")");
          btn.disabled = false;
        }
      }
    });
  });

  container.querySelectorAll(".ignore-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const record = await Store.get("processedEmails", id);
      if (record) {
        record.decision = "ignored";
        await Store.put("processedEmails", record);
      }
      showToast("Email ignoré");
      await paint(container);
    });
  });

  container.querySelectorAll(".send-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const card = container.querySelector(`[data-draft-id="${id}"]`);
      const textarea = card?.querySelector(".draft-textarea");
      const body = textarea ? textarea.value : "";
      if (!body.trim()) {
        showToast("La réponse est vide");
        return;
      }
      btn.disabled = true;
      btn.textContent = "Envoi…";
      try {
        const record = await Store.get("processedEmails", id);
        const token = await getAccessToken({ interactive: false });
        await sendReply(token, {
          threadId: record.threadId,
          to: record.from,
          subject: record.subject,
          body,
          messageIdHeader: record.messageIdHeader,
        });
        record.decision = "replied";
        record.reply = body;
        await Store.put("processedEmails", record);
        showToast("Réponse envoyée ✅");
        await paint(container);
      } catch (err) {
        showToast("Échec de l'envoi : reconnectez Gmail et réessayez");
        btn.disabled = false;
        btn.textContent = "✉️ Envoyer";
      }
    });
  });
}

async function runScan(container) {
  if (busy) return;
  busy = true;
  await paint(container);

  try {
    let token;
    try {
      token = await getAccessToken({ interactive: false });
    } catch {
      token = await getAccessToken({ interactive: true });
    }

    const settings = await getSettings();
    const existing = await Store.getAll("processedEmails");
    const knownIds = new Set(existing.map((e) => e.id));

    const messages = await listInboxMessages(token, { maxResults: 15 });
    const toProcess = messages.filter((m) => !knownIds.has(m.id));

    let trashedCount = 0;
    let draftCount = 0;
    let errorCount = 0;
    let firstError = "";

    for (const m of toProcess) {
      try {
        const full = await getMessage(token, m.id);
        const result = await classify(full, settings);

        if (result.category === "spam") {
          await trashMessage(token, m.id);
          trashedCount++;
          await Store.put("processedEmails", {
            id: m.id,
            threadId: full.threadId,
            subject: full.subject,
            from: full.from,
            category: "spam",
            decision: "trashed",
            processedAt: Date.now(),
          });
        } else if (["devis", "rendezvous", "renseignement"].includes(result.category)) {
          draftCount++;
          await Store.put("processedEmails", {
            id: m.id,
            threadId: full.threadId,
            subject: full.subject,
            from: full.from,
            messageIdHeader: full.messageIdHeader,
            category: result.category,
            reply: result.reply,
            decision: "pending",
            processedAt: Date.now(),
          });
        } else {
          await Store.put("processedEmails", {
            id: m.id,
            threadId: full.threadId,
            subject: full.subject,
            from: full.from,
            category: "autre",
            decision: "ignored",
            processedAt: Date.now(),
          });
        }
      } catch (err) {
        errorCount++;
        if (!firstError) firstError = err.message || String(err);
        console.error("Erreur traitement email", m.id, err);
      }
    }

    if (toProcess.length === 0) {
      showToast(
        messages.length === 0
          ? "Gmail n'a renvoyé aucun email dans les 14 derniers jours"
          : `${messages.length} email(s) reçu(s) mais déjà traité(s) auparavant`
      );
    } else if (errorCount > 0) {
      showToast(`${messages.length} email(s) trouvé(s), ${errorCount} erreur(s) : ${firstError}`);
    } else {
      showToast(`Analyse terminée : ${draftCount} brouillon(s), ${trashedCount} mis à la corbeille`);
    }
  } catch (err) {
    showToast("Erreur pendant l'analyse : " + (err.message || err));
  } finally {
    busy = false;
    await paint(container);
  }
}

async function classify(full, settings) {
  const res = await fetch("/.netlify/functions/classify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: full.subject,
      from: full.from,
      body: full.body,
      companyName: settings.companyName,
    }),
  });
  if (!res.ok) throw new Error(`Classification indisponible (${res.status})`);
  return res.json();
}
