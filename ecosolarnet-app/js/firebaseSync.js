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
];

const BOOTSTRAP_KEY = "ecosolarnet_sync_bootstrapped_v1";

let db = null;
let fns = null;
let applyingRemote = false;
let readyResolve;
const ready = new Promise((resolve) => {
  readyResolve = resolve;
});

async function pushToFirestore(storeName, record) {
  try {
    const ref = fns.doc(db, "artisans", WORKSPACE_ID, storeName, String(record.id));
    await fns.setDoc(ref, record);
  } catch (err) {
    console.warn("[sync] push failed", storeName, err);
  }
}

async function deleteFromFirestore(storeName, id) {
  try {
    await fns.deleteDoc(fns.doc(db, "artisans", WORKSPACE_ID, storeName, String(id)));
  } catch (err) {
    console.warn("[sync] delete failed", storeName, err);
  }
}

async function applyRemoteWrite(storeName, data) {
  const local = await Store.get(storeName, data.id);
  if (local && local._syncedAt && data._syncedAt && local._syncedAt > data._syncedAt) return;
  applyingRemote = true;
  try {
    await Store.put(storeName, data);
  } finally {
    applyingRemote = false;
  }
  window.dispatchEvent(new CustomEvent("ecosolarnet:sync"));
}

async function applyRemoteDelete(storeName, id) {
  applyingRemote = true;
  try {
    await Store.delete(storeName, id);
  } finally {
    applyingRemote = false;
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
// `ready`; nothing here needs `db`/`fns` to already exist.
export function installSyncHooks() {
  if (!FIREBASE_CONFIGURED) return;
  onStoreWrite(async (storeName, record) => {
    if (!SYNCED_STORES.includes(storeName) || applyingRemote) return;
    await ready;
    pushToFirestore(storeName, record);
  });
  onStoreDelete(async (storeName, id) => {
    if (!SYNCED_STORES.includes(storeName) || applyingRemote) return;
    await ready;
    deleteFromFirestore(storeName, id);
  });
}

export async function startFirebaseSync() {
  if (!FIREBASE_CONFIGURED) return;

  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import(`${BASE}/firebase-app.js`),
    import(`${BASE}/firebase-auth.js`),
    import(`${BASE}/firebase-firestore.js`),
  ]);
  const { getAuth, signInAnonymously, onAuthStateChanged } = authMod;
  const { initializeFirestore, persistentLocalCache, doc, setDoc, deleteDoc, collection, onSnapshot } = fsMod;
  fns = { doc, setDoc, deleteDoc };

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  db = initializeFirestore(app, { localCache: persistentLocalCache() });

  await new Promise((resolve, reject) => {
    onAuthStateChanged(auth, (user) => {
      if (user) resolve();
    });
    signInAnonymously(auth).catch(reject);
  });

  readyResolve();
  await bootstrapIfNeeded();

  for (const storeName of SYNCED_STORES) {
    onSnapshot(collection(db, "artisans", WORKSPACE_ID, storeName), (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "removed") applyRemoteDelete(storeName, change.doc.id);
        else applyRemoteWrite(storeName, change.doc.data());
      });
    });
  }
}
