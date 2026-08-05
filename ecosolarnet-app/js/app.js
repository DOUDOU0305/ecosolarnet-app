import * as dashboard from "./views/dashboard.js";
import * as clients from "./views/clients.js";
import * as devis from "./views/devis.js";
import * as planning from "./views/planning.js";
import * as settings from "./views/settings.js";

const routes = {
  dashboard,
  clients,
  devis,
  planning,
  settings,
};

const viewEl = document.getElementById("view");
const tabButtons = document.querySelectorAll(".tab-btn");

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [route, id] = hash.split("/");
  return { route: route || "dashboard", id };
}

async function renderRoute() {
  const { route, id } = parseHash();
  const mod = routes[route] || routes.dashboard;

  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.route === route);
  });

  viewEl.scrollTop = 0;
  try {
    await mod.render(viewEl, id ? { id } : undefined);
  } catch (err) {
    console.error(err);
    viewEl.innerHTML = `<div class="card"><p>Une erreur est survenue.</p><p class="muted">${err.message || err}</p></div>`;
  }
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    location.hash = `#/${btn.dataset.route}`;
  });
});

window.addEventListener("hashchange", renderRoute);
window.addEventListener("DOMContentLoaded", renderRoute);
if (document.readyState !== "loading") renderRoute();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
