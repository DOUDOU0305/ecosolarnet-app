const { withCors } = require("./_cors.js");
const { requireSecret } = require("./_auth.js");
const { listDocs } = require("./_firestoreAdmin.js");

const WORKSPACE_ID = "ecosolarnet";
const FIREBASE_PROJECT_ID = "ecosolarnet-54647";

// Point de lecture pour l'IA (pas pour Steve) : sans paramètre, liste les
// sauvegardes disponibles (date + heure seulement). Avec ?date=YYYY-MM-DD,
// renvoie le contenu complet de cette sauvegarde-là (voir save-backup.js).
// Protégé par X-App-Secret (voir _auth.js) — renvoie des données sensibles
// (toute la base clients), envoie cet en-tête même en curl manuel.
exports.handler = withCors(requireSecret(async function handler(event) {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  try {
    const docs = await listDocs(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/backups`);
    docs.sort((a, b) => (b.dateStr || "").localeCompare(a.dateStr || ""));

    const wantedDate = event.queryStringParameters?.date;
    if (wantedDate) {
      const match = docs.find((d) => d.dateStr === wantedDate);
      if (!match) return { statusCode: 404, body: "Aucune sauvegarde pour cette date" };
      return { statusCode: 200, headers: { "content-type": "application/json" }, body: match.dataJson };
    }

    const summary = docs.map((d) => ({ dateStr: d.dateStr, createdAt: d.createdAt }));
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(summary) };
  } catch (err) {
    return { statusCode: 500, body: String(err) };
  }
}));
