const { withCors } = require("./_cors.js");

exports.handler = withCors(async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { images = [] } = payload;
  if (images.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "Aucune photo fournie" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Clé API manquante côté serveur" }) };
  }

  const systemPrompt = `Tu es l'assistant marketing d'ECOSOLARNET, une entreprise de nettoyage (vitres, vérandas, pergolas, carports, garde-corps, velux, panneaux solaires) basée à Gerpinnes, en Belgique (région du Hainaut, près de Charleroi).

Steve, le gérant, vient de terminer un chantier et a pris des photos (souvent avant/après). Regarde les photos et rédige une publication courte et accrocheuse pour les réseaux sociaux (Facebook, Instagram, TikTok), dans le but d'attirer de nouveaux clients dans la région.

Consignes :
- Français, ton chaleureux et professionnel, à la première personne ("j'ai nettoyé...", "on redonne vie à...").
- Ne mentionne JAMAIS le nom, l'adresse ou tout détail identifiant le client — reste sur le résultat du travail.
- 3 à 5 phrases courtes maximum, faciles à lire sur mobile. Quelques emojis pertinents, sans excès.
- Termine par une ligne de hashtags pertinents (5 à 8), mélangeant le service rendu et la localisation (ex: #Gerpinnes #Charleroi #Hainaut #NettoyageVitres).
- Ne propose rien d'autre que le texte final : pas d'introduction, pas d'explication.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, au format exact :
{"caption": "texte complet prêt à publier, hashtags inclus à la fin"}`;

  const content = [
    { type: "text", text: "Voici les photos du chantier terminé :" },
    ...images.slice(0, 4).map((img) => ({
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
        max_tokens: 500,
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
      body: JSON.stringify({ caption: typeof parsed.caption === "string" ? parsed.caption : "" }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Erreur inconnue" }) };
  }
});
