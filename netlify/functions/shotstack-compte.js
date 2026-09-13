const { withCors } = require("./_cors.js");
const { requireSecret } = require("./_auth.js");

// Dit dans quel environnement Shotstack tourne l'app et si la clé en place est
// acceptée en production. Shotstack délivre deux clés distinctes par compte :
// une de test ("stage"), gratuite mais qui incruste un filigrane, et une de
// production ("v1"), qui exige un plan payant. Sans ce diagnostic, on ne peut
// que deviner laquelle est configurée — et deviner nous a déjà coûté une heure.
//
// La clé n'est jamais renvoyée, seulement le verdict.

exports.handler = withCors(requireSecret(async function handler(event) {
  if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.SHOTSTACK_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Clé Shotstack absente" }) };
  }

  async function sonder(env) {
    try {
      const res = await fetch(`https://api.shotstack.io/edit/${env}/templates`, {
        headers: { "x-api-key": apiKey, accept: "application/json" },
      });
      return { env, statut: res.status, accepte: res.ok };
    } catch (err) {
      return { env, statut: null, accepte: false, erreur: (err.message || "").slice(0, 120) };
    }
  }

  const stage = await sonder("stage");
  const production = await sonder("v1");

  return {
    statusCode: 200,
    body: JSON.stringify({
      environnementConfigure: process.env.SHOTSTACK_ENV === "v1" ? "v1 (production)" : "stage (test)",
      cleValideEnTest: stage.accepte,
      cleValideEnProduction: production.accepte,
      detail: { stage, production },
      verdict: production.accepte
        ? "La clé fonctionne en production : il suffit de basculer SHOTSTACK_ENV sur v1."
        : "La clé n'est acceptée qu'en test : il faut une clé de production, donc un plan payant.",
    }),
  };
}));
