const { withCors } = require("./_cors.js");
const { requireSecret } = require("./_auth.js");
const { setDoc } = require("./_firestoreAdmin.js");

const WORKSPACE_ID = "ecosolarnet";
const FIREBASE_PROJECT_ID = "ecosolarnet-54647";

// Écriture directe générique (fusion, pas remplacement — voir le correctif
// du 2026-09-20 dans _firestoreAdmin.js) sur n'importe quel document
// Firestore. Sert notamment à restaurer des fiches endommagées par
// l'ancien bug de setDoc. Protégé par X-App-Secret.
// POST { collection, id, data: {...champs à fusionner...} }
exports.handler = withCors(requireSecret(async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }
  const { collection, id, data } = payload;
  if (!collection || !id || !data || typeof data !== "object") {
    return { statusCode: 400, body: JSON.stringify({ error: "collection, id, data requis" }) };
  }
  try {
    await setDoc(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/${collection}/${id}`, {
      ...data,
      _syncedAt: Date.now(),
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) };
  }
}));
