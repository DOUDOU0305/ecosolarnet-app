exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { subject = "", from = "", body = "", companyName = "ECOSOLARNET" } = payload;
  const ownerName = "Steve";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Clé API manquante côté serveur" }) };
  }

  const systemPrompt = `Tu aides ${ownerName}, artisan indépendant qui gère l'entreprise "${companyName}" de nettoyage de vitres, vérandas, pergolas, carports et panneaux solaires à Gerpinnes, en Belgique (région Hainaut, avec des déplacements occasionnels vers Bruxelles).

Tu reçois le contenu d'un email arrivé dans sa boîte professionnelle. Ta tâche :

1. Classe l'email dans une seule de ces catégories :
   - "spam" : publicité, arnaque, phishing, newsletter non sollicitée, prospection commerciale non liée au métier
   - "devis" : le client demande un prix ou un devis pour une prestation
   - "rendezvous" : le client demande ou confirme un rendez-vous ou une date d'intervention
   - "renseignement" : le client pose une question générale sur les services, zones couvertes, disponibilités, etc.
   - "autre" : tout le reste (email personnel, administratif, facture fournisseur, conversation déjà en cours, etc.) — ne pas générer de réponse

2. Si la catégorie est "devis", "rendezvous" ou "renseignement", rédige un brouillon de réponse en français, ton chaleureux et professionnel, signé "${ownerName}", qui :
   - remercie pour le message
   - répond aux éléments concrets mentionnés
   - si des informations manquent pour chiffrer précisément (adresse, taille du bien, type de vitrage, accès), les demande poliment
   - propose de rappeler ou de fixer un rendez-vous pour affiner
   - reste courte (5 à 8 lignes maximum)
   Ne jamais indiquer de prix ferme sans confirmation, seulement des fourchettes si c'est pertinent.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :
{"category": "spam|devis|rendezvous|renseignement|autre", "reply": "texte du brouillon ou chaîne vide si non applicable"}`;

  const userContent = `De : ${from}\nSujet : ${subject}\n\nContenu :\n${String(body).slice(0, 4000)}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 700,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 502, body: JSON.stringify({ error: `Anthropic API error: ${errText.slice(0, 300)}` }) };
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || "{}";
    let parsed;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text);
    } catch {
      parsed = { category: "autre", reply: "" };
    }

    const validCategories = ["spam", "devis", "rendezvous", "renseignement", "autre"];
    const category = validCategories.includes(parsed.category) ? parsed.category : "autre";
    const reply = typeof parsed.reply === "string" ? parsed.reply : "";

    return {
      statusCode: 200,
      body: JSON.stringify({ category, reply }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Erreur inconnue" }) };
  }
};
