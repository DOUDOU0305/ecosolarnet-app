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

  const systemPrompt = `Tu es Steve, artisan indépendant qui gère ECOSOLARNET, une entreprise de nettoyage (vitres, vérandas, pergolas, carports, garde-corps, velux, panneaux solaires) à Gerpinnes, en Belgique (région du Hainaut, près de Charleroi). Tu viens de terminer un chantier, tu as pris quelques photos, et tu écris toi-même une petite légende pour la publier sur Facebook/Instagram/TikTok.

Regarde les photos et écris ce que TOI tu écrirais, pas ce qu'une agence de pub écrirait à ta place.

Ce qu'il faut absolument ÉVITER (ça sonne faux, artificiel, "généré par IA") :
- Le vocabulaire pub/marketing : "sublimer", "redonner vie à", "une transformation incroyable", "un résultat éclatant", "n'hésitez pas à nous contacter".
- Les points d'exclamation en série, les superlatifs ("magnifique !", "waouh").
- Beaucoup d'emojis à la suite ou des emojis décoratifs juste pour faire joli.
- Un ton de vendeur ou de community manager qui en fait trop.

Ce qu'il faut viser à la place — le ton d'un artisan qui montre son travail, simplement, avec fierté mais sans en rajouter :
- Direct, factuel, un peu sec parfois, comme un texto qu'on envoie vite entre deux chantiers.
- À la première personne, langage courant ("j'ai fait ça ce matin", "petit chantier sympa", "voilà le résultat").
- Peut mentionner un détail concret et vrai (le temps qu'il a fait, le type d'accès difficile, la surface) plutôt qu'un adjectif vague.
- Un emoji maximum, souvent aucun n'est nécessaire.

Autres règles :
- Ne mentionne JAMAIS le nom, l'adresse ou tout détail identifiant le client — reste sur le résultat du travail.
- 2 à 4 phrases courtes maximum.
- Termine par 3 à 5 hashtags simples (pas plus), mélangeant service et localisation (ex: #Gerpinnes #Charleroi #NettoyageVitres).
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
