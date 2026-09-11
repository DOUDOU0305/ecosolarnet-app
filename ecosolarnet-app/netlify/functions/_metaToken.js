// Source unique du jeton de Page Facebook.
//
// Le jeton stocké en variable d'environnement Netlify expire (ça s'est produit le
// 26/08/2026 : Messenger est resté muet deux semaines sans que rien ne le signale).
// On privilégie donc le jeton permanent rangé dans Firestore par meta-token-setup,
// et on retombe sur la variable d'environnement tant qu'il n'existe pas.
//
// Le jeton ne doit jamais être renvoyé à l'appelant ni écrit dans les logs.

const { getDoc, setDoc } = require("./_firestoreAdmin.js");

const FIREBASE_PROJECT_ID = "ecosolarnet-54647";
const WORKSPACE_ID = "ecosolarnet";
const DOC_PATH = `artisans/${WORKSPACE_ID}/secrets/facebook`;

let cached = null;
let cachedAt = 0;
const CACHE_MS = 5 * 60 * 1000;

async function getPageToken() {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_MS) return cached;

  try {
    const doc = await getDoc(FIREBASE_PROJECT_ID, DOC_PATH);
    if (doc && doc.pageAccessToken) {
      cached = doc.pageAccessToken;
      cachedAt = now;
      return cached;
    }
  } catch {
    // Firestore indisponible : on ne bloque pas, la variable d'environnement prend le relais.
  }

  return process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.MESSENGER_PAGE_ACCESS_TOKEN || null;
}

async function savePageToken({ pageId, pageName, pageAccessToken }) {
  await setDoc(FIREBASE_PROJECT_ID, DOC_PATH, {
    pageId,
    pageName,
    pageAccessToken,
    updatedAt: Date.now(),
  });
  cached = pageAccessToken;
  cachedAt = Date.now();
}

module.exports = { getPageToken, savePageToken, FIREBASE_PROJECT_ID, WORKSPACE_ID, DOC_PATH };
