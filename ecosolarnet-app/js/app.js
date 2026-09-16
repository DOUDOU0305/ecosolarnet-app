import * as dashboard from "./views/dashboard.js";
import { computeBriefing, briefingSpokenText } from "./views/dashboard.js";
import * as clients from "./views/clients.js";
import * as devis from "./views/devis.js";
import * as planning from "./views/planning.js";
import * as waitlist from "./views/waitlist.js";
import * as settings from "./views/settings.js";
import * as emails from "./views/emails.js";
import * as whatsapp from "./views/whatsapp.js";
import * as messenger from "./views/messenger.js";
import * as socialpost from "./views/socialpost.js";
import * as qrcodes from "./views/qrcodes.js";
import * as assistant from "./views/assistant.js";
import * as reminders from "./views/reminders.js";
import * as factures from "./views/factures.js";
import * as errorlog from "./views/errorlog.js";
import * as more from "./views/more.js";
import { getSettings, migrateIdeasIntoReminders, migrateHuggyNotifiedIntoEco, findWaitlistRevisitCandidates, resolveWaitlistRevisit } from "./db.js";
import { startAutoWatch, onTimerEvent, resolveArrivalConfirm } from "./timer.js";
import { startDepartureReminders } from "./departureReminder.js";
import { consumeRedirectToken } from "./gmailAuth.js";
import { refreshVoiceSettingsCache, speak } from "./ecoVoice.js";
import { cleanupSwipe as cleanupCalendarSwipe } from "./views/calendar.js";
import { cleanupHandsFree } from "./views/assistant.js";
import { installSyncHooks, startFirebaseSync } from "./firebaseSync.js";
import { askYesNo } from "./confirmDialog.js";
import { showToast } from "./toast.js";
import { installGlobalErrorLogging, logError } from "./errorLog.js";
import { runAutoBackupIfDue } from "./autoBackup.js";
import { repairClientCoordinates } from "./geoRepair.js";

installGlobalErrorLogging();
installSyncHooks();
migrateIdeasIntoReminders();
migrateHuggyNotifiedIntoEco();
runAutoBackupIfDue();

// Les coordonnées d'un client ne sont jamais remises en question une fois écrites :
// une adresse mal localisée le reste, sort des tournées de sa commune et fausse les
// frais de déplacement. On repasse dessus une fois par semaine, en arrière-plan.
repairClientCoordinates().catch(() => {});

// Liste d'attente : si un client déjà en attente a en fait été nettoyé
// récemment (dernier mois/semaine), on demande confirmation à Steve avant
// de la retirer, plutôt que de la supprimer sans lui demander — une par
// une pour ne jamais empiler plusieurs fenêtres à la fois.
findWaitlistRevisitCandidates().then(async (candidates) => {
  for (const c of candidates) {
    const dateLabel = new Date(c.visitDate).toLocaleDateString("fr-BE", { day: "numeric", month: "long" });
    const isNormal = await askYesNo(
      `${c.name} a été fait le ${dateLabel}. Est-ce normal que nous soyons de retour chez lui/elle ?`,
      { title: "Liste d'attente" }
    );
    await resolveWaitlistRevisit(c.entryId, c.visitDate, isNormal);
    if (!isNormal) showToast(`${c.name} retiré de la liste d'attente`);
  }
});

// Écoute globale (pas seulement quand le tableau de bord est affiché) : si le
// GPS arrive près d'un client sans être sûr à 100% duquel il s'agit, on
// demande confirmation à Steve, où qu'il soit dans l'app.
onTimerEvent(async (event, data) => {
  if (event !== "confirm-arrival") return;
  const confirmed = await askYesNo(`Êtes-vous chez ${data.clientName} ?`, { title: "Arrivée détectée" });
  resolveArrivalConfirm(data.clientId, confirmed);
});

// Débriefing vocal automatique : se lance quelques secondes après que le GPS
// a confirmé que Steve a quitté son domicile (délai mesuré dans timer.js, pas
// ici — voir le commentaire sur HOME_LEAVE_BRIEFING_DELAY_MS), pour qu'il
// l'entende pendant qu'il conduit vers son premier client — plutôt qu'à
// l'ouverture du tableau de bord, qu'il ne regarde pas forcément avant de partir.
onTimerEvent(async (event) => {
  if (event !== "departed-home") return;
  const briefing = await computeBriefing().catch(() => null);
  if (!briefing) return;
  const ok = await speak(briefingSpokenText(briefing));
  if (!ok) {
    showToast("⚠️ Le débriefing vocal n'a pas pu être lu");
    logError("Débriefing auto (départ domicile) : échec de la lecture vocale", { context: "#/dashboard" });
  }
});

// Les erreurs du chrono GPS automatique (permission refusée, plugin
// indisponible...) n'étaient auparavant affichées que si le tableau de bord
// était l'écran actif au moment où elles survenaient (l'écouteur était posé
// dans dashboard.js, réinitialisé à chaque changement d'écran) — donc
// invisibles pour moi si Steve n'était pas dessus, ou si l'app était en
// arrière-plan. Écouteur global, posé une seule fois au démarrage.
onTimerEvent((event, data) => {
  if (event !== "error") return;
  logError("Chrono GPS automatique : " + data, { context: location.hash });
});

if (location.hash.includes("access_token=")) {
  consumeRedirectToken();
  history.replaceState(null, "", `${location.pathname}${location.search}#/emails`);
}

const routes = {
  dashboard,
  clients,
  devis,
  planning,
  waitlist,
  settings,
  emails,
  whatsapp,
  messenger,
  socialpost,
  qrcodes,
  assistant,
  reminders,
  factures,
  errorlog,
  more,
};

// Ces routes n'ont plus leur propre onglet en bas (pour respecter la limite de
// 5 onglets recommandée par Apple) : elles sont accessibles via l'onglet "Plus",
// qui doit donc rester actif visuellement quand on est dessus.
const MORE_ROUTES = new Set(["waitlist", "emails", "whatsapp", "messenger", "socialpost", "qrcodes", "assistant", "settings", "reminders", "factures", "errorlog"]);

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

  const activeTabRoute = MORE_ROUTES.has(route) ? "more" : route;
  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.route === activeTabRoute);
  });

  viewEl.scrollTop = 0;
  cleanupCalendarSwipe(viewEl);
  cleanupHandsFree();
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

// Au premier attachement du listener Firestore (ou après une reconnexion),
// onSnapshot renvoie tous les documents existants d'un coup, sur chacun des
// stores synchronisés — "ecosolarnet:sync" peut donc être dispatché des
// dizaines/centaines de fois en rafale. Sans ce debounce, chaque occurrence
// relançait un renderRoute() complet (plusieurs lectures IndexedDB + un
// fetch météo), empilant des rendus concurrents et gelant le thread JS au
// démarrage. On ne garde que le dernier appel de la rafale.
let syncRenderTimer = null;
function scheduleRenderOnSync() {
  clearTimeout(syncRenderTimer);
  syncRenderTimer = setTimeout(renderRoute, 200);
}

window.addEventListener("hashchange", renderRoute);
window.addEventListener("ecosolarnet:sync", scheduleRenderOnSync);
renderRoute();

startFirebaseSync().catch((err) => console.error("[sync] init failed", err));

// Au tout premier démarrage sur un appareil, la synchro Firestore n'a pas
// forcément encore livré "settings" à cet instant : getSettings() ne verrait
// alors que les valeurs par défaut locales (autoTimerEnabled: false) et ne
// démarrerait jamais le suivi GPS, sans erreur ni indice pour Steve — c'est
// le bug du 2026-08-28 (GPS départ/arrivée qui ne se déclenchait jamais). On
// applique donc ces réglages à la fois tout de suite ET à chaque fois qu'une
// synchro arrive ensuite ; startAutoWatch()/startDepartureReminders() sont
// déjà protégées contre un double démarrage, donc les rappels répétés sont
// sans risque.
async function applyGpsSettings() {
  const s = await getSettings();
  if (s.autoTimerEnabled) startAutoWatch().catch((err) => console.error("[auto-timer] permission GPS refusée au démarrage", err));
  if (s.departureRemindersEnabled) startDepartureReminders();
}
applyGpsSettings();
window.addEventListener("ecosolarnet:sync", applyGpsSettings);

refreshVoiceSettingsCache();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
