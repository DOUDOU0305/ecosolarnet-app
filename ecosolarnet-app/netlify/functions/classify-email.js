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

  const { subject = "", from = "", cc = "", body = "", companyName = "ECOSOLARNET" } = payload;
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

2. Si la catégorie est "devis", "rendezvous" ou "renseignement", rédige un brouillon de réponse en français, court et direct dans le fond (pas un email formel avec plein de détails techniques), mais avec une **mise en page professionnelle** dans la forme. ${ownerName} donne ses devis en visitant sur place, jamais par écrit : le but de la réponse n'est donc PAS de chiffrer ou de poser plein de questions techniques.

   Règles de forme, à respecter STRICTEMENT et SANS EXCEPTION, même si le message du client est très court ou informel — ces blocs doivent TOUJOURS être présents, dans cet ordre, jamais raccourcis ni fusionnés :
   1. Formule d'appel, sur sa/ses ligne(s) :
      - Si le nom de famille de l'expéditeur (voir "De :") est identifiable et que son genre est clair, commence par "Madame [Nom]," ou "Monsieur [Nom]," seul sur sa ligne, PUIS "Bonjour," seul sur la ligne suivante.
      - Si le nom ou le genre n'est pas clairement identifiable, "Bonjour," seul suffit (ou "Bonjour Madame," / "Bonjour Monsieur," si seul le genre est clair).
   2. Un paragraphe de remerciement / contexte pour la prise de contact (ex : "J'ai bien reçu votre message et vous en remercie.") — NE JAMAIS l'omettre. Si un champ "Cc :" contient une autre personne clairement liée à la demande (ex : un·e collègue qui a transmis ou est en copie de la demande), tu peux le mentionner naturellement ici (ex : "Je fais suite au mail de [Nom] (qui est en copie) concernant..."), mais seulement si le contenu de l'email le justifie clairement — n'invente rien.
   3. Un ou plusieurs paragraphes avec la demande concrète (voir cas ci-dessous selon une ou plusieurs adresses).
   4. La formule de politesse finale : "Merci et belle journée," pour un particulier ou une demande simple et informelle ; "Bien cordialement," pour un professionnel, une institution (école, crèche, entreprise) ou un échange plus formel.
   5. La signature, seule sur sa propre ligne : "${ownerName}" — NE JAMAIS l'omettre, c'est le tout dernier bloc du message, obligatoire à chaque brouillon généré.
   Chaque bloc est séparé du suivant par une ligne vide (une vraie mise en page email, pas un bloc de texte compact).
   - Orthographe et grammaire françaises irréprochables : chaque phrase commence par une majuscule, se termine par une ponctuation correcte, pas de majuscule injustifiée au milieu d'un mot ("vous" et non "Vous", etc.).
   - N'affirme JAMAIS avoir fait une recherche, consulté un site internet, une carte, ou visité un lieu que tu n'as pas réellement pu vérifier — ne fabrique aucune action.

   Deux cas pour le paragraphe de demande concrète (bloc 3) :

   a) UNE SEULE adresse concernée (particulier ou professionnel) — c'est le cas par défaut : ${ownerName} se rend toujours sur place pour établir le devis.
      - Si le nom/prénom/adresse ne sont pas encore donnés, demande-les pour fixer un rendez-vous. Modèle : "Pourriez-vous me communiquer votre nom, prénom et votre adresse afin que je puisse vous fixer un rendez-vous pour le devis ?"
      - S'ils sont déjà donnés, ne les redemande pas : propose directement un rendez-vous à la place.
      - Si c'est une demande de rendez-vous déjà précise (date proposée), confirme simplement et demande l'adresse si elle manque.

   b) PLUSIEURS adresses/sites distincts dans la même demande (ex : plusieurs bâtiments, succursales, sites d'une même structure) — uniquement dans ce cas précis, propose une alternative à la visite systématique de chaque site : demande si des photos de chaque site peuvent être envoyées pour établir un devis plus précis et rapide, et propose en alternative de trouver une date pour visiter tous les sites le même jour si l'envoi de photos n'est pas possible, en mentionnant que quelqu'un doit être présent sur chaque site pour donner l'accès.

   - Ne jamais indiquer de prix, même une fourchette.
   - Reste concis sur le fond (pas de liste de questions techniques : surface, type de vitrage, accès, etc.), mais soigné sur la forme (paragraphes courts et aérés).

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :
{"category": "spam|devis|rendezvous|renseignement|autre", "reply": "texte du brouillon ou chaîne vide si non applicable"}`;

  const userContent = `De : ${from}\n${cc ? `Cc : ${cc}\n` : ""}Sujet : ${subject}\n\nContenu :\n${String(body).slice(0, 4000)}`;

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
});
