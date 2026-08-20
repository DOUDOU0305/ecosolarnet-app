const DB_NAME = "ecosolarnet-db";
const DB_VERSION = 10;
const STORES = ["clients", "devis", "settings", "tournees", "planningEntries", "waitlist", "schedulingPreferences", "visits", "activeTimer", "visitTimes", "huggyNotified", "processedEmails", "reminders", "ideas", "whatsappMessages", "socialPosts", "assistantCorrections"];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: "id" });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function tx(storeName, mode) {
  const db = await openDB();
  return db.transaction(storeName, mode).objectStore(storeName);
}

export { STORES };

// Sync hooks: firebaseSync.js registers here without db.js needing to know
// anything about Firebase. Keeps this module dependency-free and testable
// even when sync is never configured.
const writeHooks = [];
const deleteHooks = [];
export function onStoreWrite(fn) {
  writeHooks.push(fn);
}
export function onStoreDelete(fn) {
  deleteHooks.push(fn);
}

export const Store = {
  async getAll(storeName) {
    const store = await tx(storeName, "readonly");
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async get(storeName, id) {
    const store = await tx(storeName, "readonly");
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async put(storeName, record, { preserveSyncedAt = false } = {}) {
    if (!record.id) record.id = uid();
    // Stamped fresh on every local write (not just creation) so that
    // "last write wins" comparisons across devices actually reflect which
    // edit happened most recently. Only the sync layer, when applying a
    // write that came FROM the other device, opts out via preserveSyncedAt
    // so it doesn't overwrite that device's original timestamp with "now".
    if (!preserveSyncedAt) record._syncedAt = Date.now();
    const store = await tx(storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const req = store.put(record);
      req.onsuccess = () => {
        writeHooks.forEach((fn) => fn(storeName, record));
        resolve(record);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async delete(storeName, id) {
    const store = await tx(storeName, "readwrite");
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => {
        deleteHooks.forEach((fn) => fn(storeName, id));
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  },
};

export { uid };

// La liste "Idées" a été fusionnée dans "Rappels" (2026-08-19) : les deux
// listes se recoupaient trop. Fait passer discrètement tout ce qui restait
// dans "ideas" vers "reminders" au démarrage, sans rien perdre. Idempotent :
// une fois "ideas" vide, ça ne fait plus rien.
export async function migrateIdeasIntoReminders() {
  const ideas = await Store.getAll("ideas");
  for (const idea of ideas) {
    // Réutilise le même id que l'idée d'origine (au lieu d'en générer un
    // nouveau) : si les deux téléphones de Steve migrent chacun leur propre
    // copie locale de la même idée synchronisée, ça retombe sur le même
    // rappel plutôt que de créer un doublon sur chaque appareil.
    await Store.put("reminders", { id: idea.id, text: idea.text, done: false, createdAt: idea.createdAt });
    await Store.delete("ideas", idea.id);
  }
}

function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

const WAITLIST_REVISIT_WINDOW_DAYS = 45; // couvre "le mois dernier ou la semaine dernière"

// Cherche, parmi les clients en liste d'attente déjà liés à une fiche
// client, ceux dont la dernière visite enregistrée est récente (~mois et
// demi) alors qu'ils ne sont pas abonnés mensuel — signe possible que
// l'entrée en liste d'attente est devenue inutile et risquerait de le
// reprogrammer une seconde fois dans un délai qu'il n'a pas demandé.
// Ne modifie rien : c'est resolveWaitlistRevisit(), après la réponse de
// Steve à la question posée à l'écran, qui décide de la suite.
export async function findWaitlistRevisitCandidates() {
  const entries = await Store.getAll("waitlist");
  const linked = entries.filter((e) => e.clientId);
  if (linked.length === 0) return [];

  const [clients, visits] = await Promise.all([Store.getAll("clients"), Store.getAll("visits")]);
  const todayStr = new Date().toISOString().slice(0, 10);
  const cutoffStr = addDaysToDateStr(todayStr, -WAITLIST_REVISIT_WINDOW_DAYS);

  const candidates = [];
  for (const e of linked) {
    const client = clients.find((c) => c.id === e.clientId);
    if (!client || client.frequency === "mensuel") continue;
    const clientVisits = visits.filter((v) => v.clientId === e.clientId && v.date);
    if (clientVisits.length === 0) continue;
    const lastVisit = clientVisits.reduce((a, b) => (a.date > b.date ? a : b));
    if (lastVisit.date < cutoffStr) continue;
    // Déjà posée pour cette visite précise (Steve a répondu "oui, c'est normal") :
    // on ne redemande que si une visite plus récente encore est apparue depuis.
    if (e.lastAskedAboutVisitDate && e.lastAskedAboutVisitDate >= lastVisit.date) continue;
    candidates.push({ entryId: e.id, clientId: e.clientId, name: e.name, visitDate: lastVisit.date });
  }
  return candidates;
}

// Appelé après que Steve a répondu à "X a été fait le [date]. Est-ce normal
// que nous soyons de retour chez lui/elle ?". "Oui" (normal, la revisite est
// voulue) : on garde l'entrée, mais on retient cette visite pour ne pas
// reposer la même question tant qu'il n'y en a pas une nouvelle. "Non" (pas
// normal) : l'entrée n'a plus lieu d'être, on la retire de la liste d'attente.
export async function resolveWaitlistRevisit(entryId, visitDate, isNormal) {
  if (!isNormal) {
    await Store.delete("waitlist", entryId);
    return;
  }
  const entry = await Store.get("waitlist", entryId);
  if (!entry) return;
  await Store.put("waitlist", { ...entry, lastAskedAboutVisitDate: visitDate });
}

export const DEFAULT_SETTINGS = {
  id: "main",
  companyName: "ECOSOLARNET",
  address: "Rue du Dessus du Bois 70",
  postalCode: "6280",
  city: "Gerpinnes",
  country: "Belgique",
  iban: "",
  bic: "",
  baseLat: null,
  baseLng: null,
  rateHainautMin: 35,
  rateHainautMax: 45,
  rateBruxellesMin: 60,
  rateBruxellesMax: 70,
  travelFeePerKm: 0.40,
  solarPanelPrice: 6,
  osmosisWaterFee: 35,
  maxClientsPerDay: 6,
  workDays: [1, 2, 3, 4, 5],
  autoTimerEnabled: false,
  departureRemindersEnabled: false,
  googleReviewUrl: "https://g.page/r/CQjUFRrPW98OEAE/review",
  defenseDayCodes: ["PE", "PR", "PL", "P", "E", "GWB", "Tirs", "R"],
  huggyVoiceGender: "homme",
  huggyVoiceRate: 0.92,
  huggyVoicePitch: 1,
  windowTiers: {
    petite: {
      label: "Petite maison / Appartement",
      hint: "1 façade ou peu de vitrages",
      ext: { min: 69, max: 89 },
      full: { min: 99, max: 119 },
      subExt: { min: 60, max: 60 },
      subFull: { min: 90, max: 90 },
      subFrequency: "4x/an",
    },
    standard: {
      label: "Maison standard",
      hint: "la majorité des maisons",
      ext: { min: 99, max: 119 },
      full: { min: 149, max: 179 },
      subExt: { min: 90, max: 90 },
      subFull: { min: 140, max: 140 },
      subFrequency: "",
    },
    grande: {
      label: "Grande maison / Villa",
      hint: "grandes baies, étage, accès plus compliqué",
      ext: { min: 120, max: 160 },
      full: { min: 180, max: 240 },
      subExt: { min: 110, max: 140 },
      subFull: { min: 170, max: 210 },
      subFrequency: "",
    },
    tresGrande: {
      label: "Très grande propriété / Cas spécial",
      hint: "verrière, accès difficile — sur devis uniquement",
      startingAt: 250,
    },
  },
  windowSurcharges: {
    dirty: { label: "Vitres très sales (jamais faites)", min: 10, max: 30 },
    access: { label: "Accès difficile / hauteur", min: 10, max: 25 },
    frames: { label: "Châssis / encadrements en détail", min: 10, max: 10 },
  },
};

export async function getSettings() {
  const s = await Store.get("settings", "main");
  // Deliberately does NOT persist/push defaults when nothing exists locally yet:
  // on a device that just installed the app, "no local settings" doesn't mean
  // "no settings at all" — the real ones may still be a few seconds away via
  // sync. Writing (and thus pushing) a blank default here would clobber them.
  if (!s) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const merged = { ...current, ...patch, id: "main" };
  await Store.put("settings", merged);
  return merged;
}
