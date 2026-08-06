import * as dashboard from "./views/dashboard.js";
import * as clients from "./views/clients.js";
import * as devis from "./views/devis.js";
import * as planning from "./views/planning.js";
import * as waitlist from "./views/waitlist.js";
import * as settings from "./views/settings.js";
import { getSettings } from "./db.js";
import { startAutoWatch } from "./timer.js";
import { startDepartureReminders } from "./departureReminder.js";

const routes = {
  dashboard,
  clients,
  devis,
  planning,
  waitlist,
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

const QUICK_ACTIONS = {
  clients: { label: "+ Nouveau client", route: "clients/new" },
  devis: { label: "+ Nouveau devis", route: "devis/new" },
};
const LONG_PRESS_MS = 480;

let quickActionMenuEl = null;

function closeQuickActionMenu() {
  if (quickActionMenuEl) {
    quickActionMenuEl.remove();
    quickActionMenuEl = null;
  }
}

function showQuickActionMenu(btn, action) {
  closeQuickActionMenu();
  const rect = btn.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "quick-action-menu";
  menu.style.left = `${rect.left + rect.width / 2}px`;
  menu.style.bottom = `${window.innerHeight - rect.top + 10}px`;
  menu.innerHTML = `<button type="button">${action.label}</button>`;
  document.body.appendChild(menu);
  quickActionMenuEl = menu;

  menu.querySelector("button").addEventListener("click", (e) => {
    e.stopPropagation();
    closeQuickActionMenu();
    location.hash = `#/${action.route}`;
  });

  setTimeout(() => {
    document.addEventListener("click", closeQuickActionMenu, { once: true });
  }, 0);
}

tabButtons.forEach((btn) => {
  const route = btn.dataset.route;
  const action = QUICK_ACTIONS[route];
  let pressTimer = null;
  let longPressFired = false;
  let startX = 0;
  let startY = 0;

  if (action) {
    btn.addEventListener("pointerdown", (e) => {
      longPressFired = false;
      startX = e.clientX;
      startY = e.clientY;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        longPressFired = true;
        if (navigator.vibrate) navigator.vibrate(10);
        showQuickActionMenu(btn, action);
      }, LONG_PRESS_MS);
    });
    btn.addEventListener("pointermove", (e) => {
      if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
        clearTimeout(pressTimer);
      }
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((evt) => {
      btn.addEventListener(evt, () => clearTimeout(pressTimer));
    });
  }

  btn.addEventListener("click", () => {
    if (longPressFired) {
      longPressFired = false;
      return;
    }
    location.hash = `#/${route}`;
  });
});

window.addEventListener("hashchange", renderRoute);
renderRoute();

getSettings().then((s) => {
  if (s.autoTimerEnabled) startAutoWatch();
  if (s.departureRemindersEnabled) startDepartureReminders();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
