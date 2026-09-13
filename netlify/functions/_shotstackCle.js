// Source unique de la clé Shotstack et de son environnement.
//
// Shotstack délivre deux clés par compte : une de test ("stage"), gratuite mais qui
// incruste un filigrane sur chaque vidéo, et une de production ("v1"). Passer de
// l'une à l'autre demandait jusqu'ici de modifier deux variables d'environnement
// Netlify puis de redéployer. On range donc la clé dans Firestore, où elle se
// remplace depuis une simple page, sans redéploiement.
//
// La clé ne doit jamais être renvoyée à l'appelant ni écrite dans les logs.

const { getDoc, setDoc } = require("./_firestoreAdmin.js");

const FIREBASE_PROJECT_ID = "ecosolarnet-54647";
const DOC_PATH = "artisans/ecosolarnet/secrets/shotstack";

let cache = null;
let cacheAt = 0;
const CACHE_MS = 5 * 60 * 1000;

async function getShotstack() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;

  try {
    const doc = await getDoc(FIREBASE_PROJECT_ID, DOC_PATH);
    if (doc && doc.apiKey) {
      cache = { apiKey: doc.apiKey, env: doc.env === "stage" ? "stage" : "v1" };
      cacheAt = now;
      return cache;
    }
  } catch {
    // Firestore indisponible : on ne bloque pas, les variables d'environnement prennent le relais.
  }

  return {
    apiKey: process.env.SHOTSTACK_API_KEY || null,
    env: process.env.SHOTSTACK_ENV === "v1" ? "v1" : "stage",
  };
}

async function saveShotstack({ apiKey, env }) {
  await setDoc(FIREBASE_PROJECT_ID, DOC_PATH, {
    apiKey,
    env: env === "stage" ? "stage" : "v1",
    updatedAt: Date.now(),
  });
  cache = { apiKey, env: env === "stage" ? "stage" : "v1" };
  cacheAt = Date.now();
}

module.exports = { getShotstack, saveShotstack, FIREBASE_PROJECT_ID, DOC_PATH };
