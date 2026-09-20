const { withCors } = require("./_cors.js");
const { requireSecret } = require("./_auth.js");
const { setDoc, listDocs } = require("./_firestoreAdmin.js");

const WORKSPACE_ID = "ecosolarnet";
const FIREBASE_PROJECT_ID = "ecosolarnet-54647";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Utilitaire d'appoint : crée en une fois plusieurs "jours bloqués"
// (empêchement personnel / jour de défense) dans planningEntries, même
// forme que celle écrite par calendar.js saveDefenseDay() — { date,
// tourneeId: null, label: code }. Sert à encoder d'un coup le planning de
// service de Steve (police/armée) depuis une photo, plutôt que jour par
// jour dans l'app. Protégé par X-App-Secret.
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
  const { blocks } = payload;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "blocks: [{date, label}] requis" }) };
  }

  try {
    const existing = await listDocs(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/planningEntries`);
    const existingByDate = new Map(existing.map((e) => [e.date, e]));

    const results = [];
    for (const { date, label } of blocks) {
      if (!date || !label) continue;
      const current = existingByDate.get(date);
      // Un jour qui a déjà une vraie tournée client planifiée (tourneeId
      // non nul) ne doit JAMAIS être écrasé silencieusement par un blocage
      // — ce serait effacer un rendez-vous client réel. On saute et on le
      // signale plutôt que d'agir à l'aveugle.
      if (current?.tourneeId) {
        results.push({ date, label, skipped: true, reason: `Une tournée existe déjà ce jour-là (${current.label || current.tourneeId})` });
        continue;
      }
      const id = current?.id || uid();
      await setDoc(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/planningEntries/${id}`, {
        id,
        date,
        tourneeId: null,
        label,
        _syncedAt: Date.now(),
      });
      results.push({ date, label, id, overwrote: !!current });
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, results }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) };
  }
}));
