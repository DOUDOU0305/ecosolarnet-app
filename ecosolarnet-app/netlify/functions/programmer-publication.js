const { withCors } = require("./_cors.js");
const { requireSecret } = require("./_auth.js");
const { listDocs, setDoc, deleteDoc } = require("./_firestoreAdmin.js");
const { FIREBASE_PROJECT_ID, WORKSPACE_ID } = require("./_metaToken.js");

// La file d'attente des publications Instagram à venir, que publier-programme.js
// vide à l'heure dite. Voir l'en-tête de ce fichier-là pour le pourquoi.
//
// POST { action: "ajouter", quand, message, photoUrls[] | videoUrl, sujet? }
// POST { action: "liste" }
// POST { action: "annuler", id }
//
// "quand" est un horodatage : soit des millisecondes depuis 1970, soit une date
// ISO ("2026-09-27T10:00:00+02:00"). Écrire le décalage horaire explicitement,
// sinon la date est lue en UTC et la publication part deux heures trop tôt.

const COLLECTION = `artisans/${WORKSPACE_ID}/publicationsProgrammees`;

function json(statusCode, body) {
  return { statusCode, body: JSON.stringify(body) };
}

function lireQuand(valeur) {
  if (typeof valeur === "number" && Number.isFinite(valeur)) return valeur;
  if (typeof valeur === "string") {
    const t = Date.parse(valeur);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

exports.handler = withCors(requireSecret(async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "JSON invalide" });
  }

  if (payload.action === "liste") {
    const file = await listDocs(FIREBASE_PROJECT_ID, COLLECTION);
    file.sort((a, b) => (a.quand || 0) - (b.quand || 0));
    return json(200, { file });
  }

  if (payload.action === "annuler") {
    if (!payload.id) return json(400, { error: "id requis" });
    await deleteDoc(FIREBASE_PROJECT_ID, `${COLLECTION}/${payload.id}`);
    return json(200, { ok: true });
  }

  if (payload.action === "ajouter") {
    const quand = lireQuand(payload.quand);
    if (quand === null) return json(400, { error: "quand invalide" });

    const photoUrls = Array.isArray(payload.photoUrls) ? payload.photoUrls.filter(Boolean) : [];
    if (!photoUrls.length && !payload.videoUrl) {
      return json(400, { error: "photoUrls ou videoUrl requis" });
    }
    if (photoUrls.length > 10) {
      return json(400, { error: "Instagram n'accepte pas plus de 10 photos" });
    }

    const id = `pub-${quand}-${Math.random().toString(36).slice(2, 8)}`;
    const entree = {
      id,
      quand,
      sujet: typeof payload.sujet === "string" ? payload.sujet : "",
      message: typeof payload.message === "string" ? payload.message : "",
      photoUrls,
      videoUrl: typeof payload.videoUrl === "string" ? payload.videoUrl : "",
      etat: "attente",
      creationId: "",
      lien: "",
      erreur: "",
      essais: 0,
      creeLe: Date.now(),
      traiteLe: 0,
    };
    await setDoc(FIREBASE_PROJECT_ID, `${COLLECTION}/${id}`, entree);
    return json(200, { ok: true, entree });
  }

  return json(400, { error: `Action inconnue : ${payload.action}` });
}));
