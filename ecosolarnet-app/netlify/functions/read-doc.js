const { withCors } = require("./_cors.js");
const { requireSecret } = require("./_auth.js");
const { getDoc, listDocs } = require("./_firestoreAdmin.js");

const WORKSPACE_ID = "ecosolarnet";
const FIREBASE_PROJECT_ID = "ecosolarnet-54647";

// Lecture directe et immédiate d'une collection ou d'un document Firestore,
// pour diagnostiquer sans dépendre de la sauvegarde quotidienne (qui peut
// être en retard ou incomplète). Protégé par X-App-Secret.
// GET ?collection=clients            -> tous les documents de la collection
// GET ?collection=settings&id=main   -> un document précis
exports.handler = withCors(requireSecret(async function handler(event) {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  const { collection, id } = event.queryStringParameters || {};
  if (!collection) {
    return { statusCode: 400, body: JSON.stringify({ error: "collection requis" }) };
  }
  try {
    if (id) {
      const doc = await getDoc(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/${collection}/${id}`);
      return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(doc) };
    }
    const docs = await listDocs(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/${collection}`);
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(docs) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) };
  }
}));
