const DB_NAME = "ecosolarnet-db";
const DB_VERSION = 7;
const STORES = ["clients", "devis", "settings", "tournees", "planningEntries", "waitlist", "schedulingPreferences", "visits", "activeTimer", "visitTimes", "huggyNotified", "processedEmails", "reminders", "ideas"];

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

  async put(storeName, record) {
    if (!record.id) record.id = uid();
    if (!record._syncedAt) record._syncedAt = Date.now();
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
