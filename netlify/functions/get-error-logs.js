const { withCors } = require("./_cors.js");
const { listDocs } = require("./_firestoreAdmin.js");

const WORKSPACE_ID = "ecosolarnet";
const FIREBASE_PROJECT_ID = "ecosolarnet-54647";

// Point de lecture pour l'IA (pas pour Steve) : liste les erreurs
// remontées par l'app (voir js/errorLog.js), les plus récentes en premier.
// Permet de repérer un bug avant que Steve ne le signale.
exports.handler = withCors(async function handler(event) {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  try {
    const logs = await listDocs(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/errorLogs`);
    logs.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(logs) };
  } catch (err) {
    return { statusCode: 500, body: String(err) };
  }
});
