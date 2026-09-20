const { withCors } = require("./_cors.js");
const { requireSecret } = require("./_auth.js");
const { setDoc } = require("./_firestoreAdmin.js");

const WORKSPACE_ID = "ecosolarnet";
const FIREBASE_PROJECT_ID = "ecosolarnet-54647";

// Utilitaire d'appoint pour corriger les coordonnées GPS d'une fiche client
// depuis le serveur, quand le géocodage automatique échoue pour une adresse
// précise (ex. Pierre FALLON, 2026-09-19 — Nominatim ne trouvait pas "Rue du
// Try al Hutte", seulement "Try Al Hutte"). Protégé par X-App-Secret.
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
  const { clientId, lat, lng, collection } = payload;
  if (!clientId || typeof lat !== "number" || typeof lng !== "number") {
    return { statusCode: 400, body: JSON.stringify({ error: "clientId, lat, lng (nombres) requis" }) };
  }
  try {
    // collection optionnelle : "clients" par défaut, mais une entrée de
    // liste d'attente (waitlist) porte ses propres lat/lng utilisés
    // directement par le regroupement de tournées avant validation.
    await setDoc(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/${collection || "clients"}/${clientId}`, {
      lat,
      lng,
      _syncedAt: Date.now(),
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) };
  }
}));
