const { withCors } = require("./_cors.js");
const { requireSecret } = require("./_auth.js");
const { getShotstack, saveShotstack } = require("./_shotstackCle.js");

// Reçoit une clé Shotstack, vérifie qu'elle fonctionne, puis l'enregistre.
//
// La vérification avant enregistrement n'est pas un luxe : une clé de test
// s'enregistrerait sans broncher et Steve ne découvrirait le filigrane qu'après
// avoir monté une vidéo. Ici on sait tout de suite dans quel environnement
// elle est valable, et on refuse d'enregistrer une clé qui ne marche nulle part.
//
// POST { action: "enregistrer", cle: "..." }
// POST { action: "etat" }   -> dit seulement quel environnement est actif

function json(statusCode, body) {
  return { statusCode, body: JSON.stringify(body) };
}

async function sonder(cle, env) {
  try {
    const res = await fetch(`https://api.shotstack.io/edit/${env}/templates`, {
      headers: { "x-api-key": cle, accept: "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  }
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

  if (payload.action === "etat") {
    const { apiKey, env } = await getShotstack();
    return json(200, {
      configuree: Boolean(apiKey),
      environnement: env,
      filigrane: env !== "v1",
    });
  }

  const cle = typeof payload.cle === "string" ? payload.cle.trim() : "";
  if (!cle) return json(400, { error: "Clé manquante" });

  const production = await sonder(cle, "v1");
  const test = production ? false : await sonder(cle, "stage");

  if (!production && !test) {
    return json(400, {
      error: "Cette clé n'est acceptée ni en production ni en test",
      indice: "Vérifiez qu'elle a été copiée en entier, depuis la page API Keys de Shotstack.",
    });
  }

  await saveShotstack({ apiKey: cle, env: production ? "v1" : "stage" });

  return json(200, {
    ok: true,
    environnement: production ? "v1" : "stage",
    filigrane: !production,
    message: production
      ? "Clé de production enregistrée — les vidéos sortiront sans filigrane."
      : "Clé enregistrée, mais c'est une clé de test : les vidéos garderont le filigrane.",
  });
}));
