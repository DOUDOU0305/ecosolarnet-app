import { Store, onStoreWrite, onStoreDelete } from "./db.js";
import { firebaseConfig, WORKSPACE_ID, FIREBASE_CONFIGURED } from "./firebaseConfig.js";

const SDK_VERSION = "11.3.1";
const BASE = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

// Stores that carry shared business data and need to sync between devices.
// Left out on purpose: activeTimer, huggyNotified, processedEmails — those
// are per-device operational/dedup state, syncing them would just be noise.
const SYNCED_STORES = [
  "clients",
  "devis",
  "settings",
  "tournees",
  "planningEntries",
  "waitlist",
  "schedulingPreferences",
  "visits",
  "visitTimes",
  "reminders",
  "ideas",
  "whatsappMessages",
];

const BOOTSTRAP_KEY = "ecosolarnet_sync_bootstrapped_v1";

let db = null;
// Per-record (not global) so that applying an incoming remote write for one
// record can't suppress the push of an unrelated local edit made to a
// different record at the same moment — a global flag here previously
// caused local edits to be silently dropped from sync under exactly that
// kind of overlap.
const applyingRemoteKeys = new Set();
let readyResolve;
const ready = new Promise((resolve) => {
  readyResolve = resolve;
});

// Dynamic `import()` of a remote ES module hangs indefinitely in the
// Capacitor/WKWebView shell (plain fetch() to the same URL works fine —
// this is a WebKit quirk with cross-origin module loading in that context,
// not a network issue). Classic <script> tags don't hit that code path, so
// we load Firebase's "compat" (v8-shaped API) builds this way instead.
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load " + src));
    document.head.appendChild(s);
  });
}

function docRef(storeName, id) {
  return db.collection("artisans").doc(WORKSPACE_ID).collection(storeName).doc(String(id));
}

async function pushToFirestore(storeName, record) {
  try {
    await docRef(storeName, record.id).set(record);
  } catch (err) {
    console.warn("[sync] push failed", storeName, err);
  }
}

async function deleteFromFirestore(storeName, id) {
  try {
    await docRef(storeName, id).delete();
  } catch (err) {
    console.warn("[sync] delete failed", storeName, err);
  }
}

async function applyRemoteWrite(storeName, data) {
  const local = await Store.get(storeName, data.id);
  if (local && local._syncedAt && data._syncedAt && local._syncedAt > data._syncedAt) return;
  const key = `${storeName}:${data.id}`;
  applyingRemoteKeys.add(key);
  try {
    await Store.put(storeName, data, { preserveSyncedAt: true });
  } finally {
    applyingRemoteKeys.delete(key);
  }
  window.dispatchEvent(new CustomEvent("ecosolarnet:sync"));
}

async function applyRemoteDelete(storeName, id) {
  const key = `${storeName}:${id}`;
  applyingRemoteKeys.add(key);
  try {
    await Store.delete(storeName, id);
  } finally {
    applyingRemoteKeys.delete(key);
  }
  window.dispatchEvent(new CustomEvent("ecosolarnet:sync"));
}

async function bootstrapIfNeeded() {
  if (localStorage.getItem(BOOTSTRAP_KEY)) return;
  for (const storeName of SYNCED_STORES) {
    const records = await Store.getAll(storeName);
    for (const record of records) {
      await pushToFirestore(storeName, record);
    }
  }
  localStorage.setItem(BOOTSTRAP_KEY, "1");
}

// Registered synchronously (before any `await`) so that a write/delete made
// in the first instant after app boot — before Firebase has finished its
// async init below — isn't silently dropped. The push itself just waits on
// `ready`; nothing here needs `db` to already exist.
export function installSyncHooks() {
  if (!FIREBASE_CONFIGURED) return;
  onStoreWrite(async (storeName, record) => {
    if (!SYNCED_STORES.includes(storeName) || applyingRemoteKeys.has(`${storeName}:${record.id}`)) return;
    await ready;
    pushToFirestore(storeName, record);
  });
  onStoreDelete(async (storeName, id) => {
    if (!SYNCED_STORES.includes(storeName) || applyingRemoteKeys.has(`${storeName}:${id}`)) return;
    await ready;
    deleteFromFirestore(storeName, id);
  });
}

export async function startFirebaseSync() {
  if (!FIREBASE_CONFIGURED) return;

  await loadScript(`${BASE}/firebase-app-compat.js`);
  await Promise.all([loadScript(`${BASE}/firebase-auth-compat.js`), loadScript(`${BASE}/firebase-firestore-compat.js`)]);

  const fb = window.firebase;
  fb.initializeApp(firebaseConfig);
  const auth = fb.auth();
  db = fb.firestore();
  try {
    await db.enablePersistence();
  } catch (err) {
    // Multi-tab or unsupported browser: falls back to in-memory cache, fine.
    console.warn("[sync] offline persistence unavailable", err.code || err);
  }

  await new Promise((resolve, reject) => {
    auth.onAuthStateChanged((user) => {
      if (user) resolve();
    });
    auth.signInAnonymously().catch(reject);
  });

  readyResolve();
  await bootstrapIfNeeded();

  for (const storeName of SYNCED_STORES) {
    db.collection("artisans")
      .doc(WORKSPACE_ID)
      .collection(storeName)
      .onSnapshot((snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "removed") applyRemoteDelete(storeName, change.doc.id);
          else applyRemoteWrite(storeName, change.doc.data());
        });
      });
  }
}
