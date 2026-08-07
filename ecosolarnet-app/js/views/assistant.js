import { Store, getSettings } from "../db.js";
import { escapeHtml, showToast } from "../toast.js";
import { speak } from "../huggyVoice.js";
import { geocodeAddress, fullAddress } from "../geo.js";

let log = [];
let busy = false;

export async function render(container) {
  paint(container);
}

function paint(container) {
  container.innerHTML = `
    <h1>Assistant</h1>
    <p class="muted" style="margin-top:-10px">Dictez une demande, l'IA s'en occupe</p>

    <div class="card">
      <p class="muted" style="margin-top:0">Touchez le champ, utilisez le micro 🎤 de votre clavier pour dicter, puis touchez "Envoyer".</p>
      <textarea id="assistant-input" rows="3" placeholder="Ex : Ajoute un client Jean Dupont, rue de la Gare 5 à Gerpinnes, téléphone 0470 12 34 56"></textarea>
      <button type="button" class="btn block" id="assistant-send-btn" ${busy ? "disabled" : ""}>${busy ? "…" : "🎤 Envoyer"}</button>
    </div>

    <div id="assistant-log">
      ${log.length === 0 ? `
        <div class="empty-state">
          <div class="big">🎙️</div>
          <p>Essayez : "Ajoute un client...", "Mets [nom] au planning le 14 août à 10h30", ou posez une question.</p>
        </div>
      ` : log.slice().reverse().map((entry) => `
        <div class="card" style="background:${entry.role === "user" ? "var(--fill)" : "var(--teal-light)"}">
          <span class="muted" style="font-size:11px;font-weight:600;letter-spacing:0.3px">${entry.role === "user" ? "VOUS" : "ASSISTANT"}</span>
          <p style="margin:4px 0 0;white-space:pre-wrap">${escapeHtml(entry.text)}</p>
        </div>
      `).join("")}
    </div>
  `;

  container.querySelector("#assistant-send-btn").addEventListener("click", () => handleSend(container));
  container.querySelector("#assistant-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(container);
    }
  });
}

function parseHM(str) {
  const [h, m] = String(str).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

async function scheduleClientOnDate(client, dateStr, startMinutes, durationMinutes) {
  const existingEntries = await Store.getAll("planningEntries");
  const currentEntry = existingEntries.find((p) => p.date === dateStr);
  const tournee = currentEntry?.tourneeId ? await Store.get("tournees", currentEntry.tourneeId) : null;

  const clientIds = tournee ? [...tournee.clientIds] : [];
  const clientNames = tournee ? [...tournee.clientNames] : [];
  if (!clientIds.includes(client.id)) {
    clientIds.push(client.id);
    clientNames.push(client.name);
  }

  const saved = await Store.put("tournees", {
    id: tournee?.id,
    name: `Jour du ${dateStr}`,
    clientIds,
    clientNames,
    km: null,
  });

  await Store.put("planningEntries", { id: currentEntry?.id, date: dateStr, tourneeId: saved.id, label: saved.name });
  await Store.put("visitTimes", {
    id: `${dateStr}_${client.id}`,
    date: dateStr,
    clientId: client.id,
    clientName: client.name,
    startMinutes,
    durationMinutes,
  });
}

async function handleSend(container) {
  if (busy) return;
  const textarea = container.querySelector("#assistant-input");
  const message = textarea.value.trim();
  if (!message) return;

  busy = true;
  log.push({ role: "user", text: message });
  paint(container);

  try {
    const settings = await getSettings();
    const allClients = await Store.getAll("clients");
    const res = await fetch("/.netlify/functions/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        clients: allClients.map((c) => ({ id: c.id, name: c.name })),
        todayDate: new Date().toISOString().slice(0, 10),
        companyName: settings.companyName,
      }),
    });
    if (!res.ok) throw new Error(`Assistant indisponible (${res.status})`);
    const data = await res.json();

    let finalReply = data.reply;

    if (data.intent === "add_client" && data.client?.name) {
      const record = await Store.put("clients", {
        name: data.client.name,
        address: data.client.address || "",
        postalCode: data.client.postalCode || "",
        city: data.client.city || "",
        phone: data.client.phone || "",
        email: "",
        serviceTypes: ["vitres"],
        frequency: "ponctuel",
        notes: "",
        lat: null,
        lng: null,
      });
      if (record.address) {
        geocodeAddress(fullAddress(record))
          .then((coords) => {
            if (coords) Store.put("clients", { ...record, lat: coords.lat, lng: coords.lng });
          })
          .catch(() => {});
      }
    } else if (data.intent === "schedule_appointment" && data.appointment?.clientName && data.appointment?.date) {
      const spoken = data.appointment.clientName.toLowerCase();
      const matched = allClients.find((c) => c.name.toLowerCase() === spoken)
        || allClients.find((c) => c.name.toLowerCase().includes(spoken) || spoken.includes(c.name.toLowerCase()));
      if (matched) {
        const visits = await Store.getAll("visits");
        const clientVisits = visits.filter((v) => v.clientId === matched.id);
        const avgMin = clientVisits.length > 0
          ? Math.round(clientVisits.reduce((s, v) => s + v.durationSeconds, 0) / clientVisits.length / 60)
          : 60;
        const startMinutes = data.appointment.time ? parseHM(data.appointment.time) : 8 * 60;
        await scheduleClientOnDate(matched, data.appointment.date, startMinutes, Math.max(15, avgMin));
      } else {
        finalReply = `Je n'ai pas trouvé de client nommé "${data.appointment.clientName}" — ajoutez-le d'abord.`;
      }
    }

    log.push({ role: "assistant", text: finalReply });
    speak(finalReply);
  } catch (err) {
    const errText = "Erreur : " + (err.message || err);
    log.push({ role: "assistant", text: errText });
    showToast(errText);
  } finally {
    busy = false;
    paint(container);
    const freshTextarea = container.querySelector("#assistant-input");
    if (freshTextarea) freshTextarea.value = "";
  }
}
