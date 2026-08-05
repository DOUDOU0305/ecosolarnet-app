import { Store, getSettings } from "../db.js";
import { escapeHtml } from "../toast.js";

function fmtEuro(n) {
  return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",") + " €";
}

export async function render(container) {
  const settings = await getSettings();
  const clients = await Store.getAll("clients");
  const devisList = await Store.getAll("devis");
  const entries = await Store.getAll("planningEntries");

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const monthPrefix = todayStr.slice(0, 7);

  const devisCeMois = devisList.filter((d) => (d.date || "").startsWith(monthPrefix));
  const caCeMois = devisCeMois.filter((d) => d.status === "accepte").reduce((s, d) => s + d.total, 0);

  const upcoming = entries
    .filter((e) => e.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  container.innerHTML = `
    <h1>Bonjour 👋</h1>
    <p class="muted" style="margin-top:-10px">${settings.companyName} — ${now.toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long" })}</p>

    <div class="stat-row">
      <div class="stat-card">
        <div class="num">${clients.length}</div>
        <div class="label">Clients</div>
      </div>
      <div class="stat-card alt">
        <div class="num">${fmtEuro(caCeMois)}</div>
        <div class="label">Devis acceptés ce mois</div>
      </div>
    </div>

    <div class="card">
      <div class="section-title-row">
        <h3 style="margin-top:0">Prochains jours planifiés</h3>
      </div>
      ${upcoming.length === 0 ? `
        <p class="muted">Rien de planifié pour l'instant. Allez dans <strong>Tournées</strong> pour organiser votre mois.</p>
      ` : upcoming.map((e) => `
        <div class="list-item">
          <span>${new Date(e.date).toLocaleDateString("fr-BE", { weekday: "short", day: "numeric", month: "short" })}</span>
          <strong>${escapeHtml(e.label)}</strong>
        </div>
      `).join("")}
    </div>

    <div class="card">
      <h3 style="margin-top:0">Actions rapides</h3>
      <button class="btn block" id="qa-client" style="margin-bottom:8px">+ Nouveau client</button>
      <button class="btn secondary block" id="qa-devis" style="margin-bottom:8px">+ Nouveau devis</button>
      <button class="btn secondary block" id="qa-planning">🗺️ Voir les tournées</button>
    </div>
  `;

  container.querySelector("#qa-client").addEventListener("click", () => (location.hash = "#/clients/new"));
  container.querySelector("#qa-devis").addEventListener("click", () => (location.hash = "#/devis/new"));
  container.querySelector("#qa-planning").addEventListener("click", () => (location.hash = "#/planning"));
}
