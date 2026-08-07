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
  const ownerName = "Steve Peters";

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

2. Si la catégorie est "devis", "rendezvous" ou "renseignement", rédige un brouillon de réponse en français, court et direct dans le fond (pas un email formel avec plein de détails techniques), mais avec une **mise en page professionnelle** dans la forme. ${ownerName} donne ses devis en visitant sur place, jamais par écrit : le but de la réponse n'est donc PAS de chiffrer ou de poser plein de questions techniques, mais simplement d'obtenir nom, prénom et adresse pour fixer un rendez-vous.

   Règles de forme, à respecter strictement :
   - La formule d'appel est TOUJOURS générique : "Bonjour," seul (ou "Bonjour Madame," / "Bonjour Monsieur," si le genre est clairement identifiable) — ne jamais reprendre le nom ou le prénom du client après "Bonjour".
   - Structure en plusieurs courts paragraphes séparés par une ligne vide (une vraie mise en page email, pas un bloc de texte compact) : la formule d'appel seule sur sa ligne, puis un paragraphe de remerciement, puis un paragraphe avec la demande concrète, puis la formule de politesse finale, puis la signature sur sa propre ligne.
   - Orthographe et grammaire françaises irréprochables : chaque phrase commence par une majuscule, se termine par une ponctuation correcte, pas de majuscule injustifiée au milieu d'un mot ("vous" et non "Vous", etc.).

   Modèle à suivre pour le contenu (adapte les formulations selon le message reçu, mais garde cette structure en paragraphes séparés) :
   "Bonjour,\\n\\nJ'ai bien reçu votre message et vous en remercie.\\n\\nPourriez-vous me communiquer votre nom, prénom et votre adresse afin que je puisse vous fixer un rendez-vous pour le devis ?\\n\\nMerci et belle journée.\\n\\n${ownerName}"

   - Si le nom/prénom/adresse sont déjà donnés dans le message, ne les redemande pas : propose directement un rendez-vous à la place.
   - Si c'est une demande de rendez-vous déjà précise (date proposée), confirme simplement et demande l'adresse si elle manque.
   - Ne jamais indiquer de prix, même une fourchette.
   - Reste concis sur le fond (pas de liste de questions techniques : surface, type de vitrage, accès, etc.), mais soigné sur la forme (paragraphes courts et aérés).

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
    const textBlock = (data.content || []).find((block) => block.type === "text");
    const text = textBlock?.text || "{}";
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
