const { withCors } = require("./_cors.js");
const { setDoc, listDocs, deleteDoc } = require("./_firestoreAdmin.js");

const WORKSPACE_ID = "ecosolarnet";
const FIREBASE_PROJECT_ID = "ecosolarnet-54647";
const RETENTION_DAYS = 60;

// Reçoit une sauvegarde complète (voir js/autoBackup.js), un doc Firestore
// par jour (dateStr comme id, donc un second appel le même jour écrase le
// premier plutôt que d'en créer un nouveau). Purge celles trop anciennes à
// chaque appel pour ne jamais accumuler indéfiniment.
exports.handler = withCors(async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  try {
    const { dateStr, backup } = JSON.parse(event.body || "{}");
    if (!dateStr || !backup) {
      return { statusCode: 400, body: "dateStr et backup requis" };
    }

    await setDoc(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/backups/${dateStr}`, {
      dateStr,
      dataJson: JSON.stringify(backup),
      createdAt: new Date().toISOString(),
    });

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const existing = await listDocs(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/backups`);
    for (const doc of existing) {
      if (doc.dateStr && doc.dateStr < cutoff) {
        await deleteDoc(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/backups/${doc.dateStr}`);
      }
    }

    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: String(err) };
  }
});
