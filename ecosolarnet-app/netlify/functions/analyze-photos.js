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

  const { images = [], settings = {} } = payload;
  if (images.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "Aucune photo fournie" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Clé API manquante côté serveur" }) };
  }

  const tiers = settings.windowTiers || {};
  const tiersText = Object.entries(tiers)
    .map(([key, t]) => `- "${key}" (${t.label}) : ${t.hint || ""}`)
    .join("\n");

  const systemPrompt = `Tu es l'assistant qui aide Steve Peters, gérant d'ECOSOLARNET (nettoyage de vitres, vérandas, pergolas, carports et panneaux solaires à Gerpinnes, Belgique), à préparer un devis à partir de photos prises chez un client.

Regarde attentivement chaque photo et détermine quelles prestations parmi celles-ci sont visibles et pertinentes : vitres, véranda, pergola, carport, panneaux solaires.

Pour les vitres, si tu identifies cette prestation, choisis la catégorie de maison la plus proche parmi :
${tiersText}
Choisis aussi la formule : "ext" (extérieur uniquement) ou "full" (intérieur + extérieur) — si les photos ne permettent pas de le déterminer, choisis "ext" par défaut.

Estime aussi, pour les vitres, le temps de nettoyage nécessaire en minutes. C'est une information interne pour Steve (pas pour le client), donc pars du principe pessimiste que les vitres sont très sales et n'ont jamais été nettoyées, même si elles paraissent propres sur la photo — ça lui sert à bloquer assez de temps dans son planning plutôt qu'à être pris de court. Base-toi sur le nombre de fenêtres visibles, leur taille et la catégorie de maison choisie.

Pour les panneaux solaires, si tu peux compter les panneaux visibles sur la ou les photos, indique ce nombre. Si tu ne peux pas compter avec une confiance raisonnable, ne renvoie pas de nombre.

Pour véranda / pergola / carport, si la prestation est visible, estime un nombre d'heures de travail raisonnable (nombre décimal, ex: 1.5) pour un nettoyage complet, en te basant sur la taille apparente.

Sois prudent : ce ne sont que des estimations à partir de photos, que Steve vérifiera et ajustera lui-même avant d'envoyer le devis. N'invente rien qui n'est pas visible sur les photos.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, au format exact :
{"servicesDetected": ["vitres"], "vitres": {"tier": "standard", "formule": "ext", "cleaningTimeMinutes": 90}, "panneaux": {"panelCount": 12}, "veranda": {"hours": 1.5}, "pergola": {"hours": 1}, "carport": {"hours": 1}, "notes": "courte explication en français de ce que tu as vu et pourquoi tu proposes ces choix"}

N'inclus une clé de service (vitres/panneaux/veranda/pergola/carport) que si ce service apparaît dans "servicesDetected". "notes" doit toujours être rempli.`;

  const content = [
    { type: "text", text: "Voici la ou les photos prises chez le client :" },
    ...images.slice(0, 6).map((img) => ({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: img },
    })),
  ];

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
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 502, body: JSON.stringify({ error: `Anthropic API error: ${errText.slice(0, 300)}` }) };
    }

    const data = await res.json();
    const textBlock = (data.content || []).find((block) => block.type === "text");
    const text = textBlock?.text || "{}";
    let parsed;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text);
    } catch {
      return { statusCode: 502, body: JSON.stringify({ error: "Réponse IA illisible" }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        servicesDetected: Array.isArray(parsed.servicesDetected) ? parsed.servicesDetected : [],
        vitres: parsed.vitres || null,
        panneaux: parsed.panneaux || null,
        veranda: parsed.veranda || null,
        pergola: parsed.pergola || null,
        carport: parsed.carport || null,
        notes: typeof parsed.notes === "string" ? parsed.notes : "",
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Erreur inconnue" }) };
  }
};
