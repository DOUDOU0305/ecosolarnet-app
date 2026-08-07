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

  const { message = "", clients = [], todayDate = "", companyName = "ECOSOLARNET" } = payload;
  const ownerName = "Steve Peters";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Clé API manquante côté serveur" }) };
  }

  const clientListText = clients.length > 0 ? clients.map((c) => `- ${c.name}`).join("\n") : "(aucun client enregistré pour l'instant)";

  const systemPrompt = `Tu es l'assistant vocal intégré à l'application professionnelle de ${ownerName}, qui gère "${companyName}", entreprise de nettoyage de vitres, vérandas, pergolas, carports et panneaux solaires à Gerpinnes, en Belgique. Aujourd'hui nous sommes le ${todayDate}.

${ownerName} te dicte une phrase (via la dictée vocale de son iPhone, donc le texte peut contenir des imperfections de transcription). Détermine ce qu'il veut faire parmi :

- "add_client" : il veut enregistrer un nouveau client. Extrais ce que tu peux : nom complet, adresse (rue et numéro), code postal, ville, téléphone. Laisse vide ("") ce qui n'est pas mentionné.
- "schedule_appointment" : il veut planifier un rendez-vous pour un client à une date (et éventuellement une heure) donnée. Essaie de faire correspondre le nom cité à un client existant dans cette liste :
${clientListText}
  Si un nom correspond clairement (même approximativement, la dictée vocale déforme parfois les noms), renvoie exactement le nom tel qu'il apparaît dans la liste ci-dessus. Sinon renvoie le nom tel qu'il l'a prononcé.
  Convertis la date en format AAAA-MM-JJ (déduis l'année à partir d'aujourd'hui si elle n'est pas précisée, en choisissant la prochaine occurrence de cette date si elle semble déjà passée). Convertis l'heure en HH:MM (24h) si mentionnée, sinon laisse vide.
- "general_question" : toute autre question ou demande de conversation générale. Réponds-y directement et brièvement en français. Si la question nécessite une information en temps réel que tu n'as pas (météo actuelle, horaires d'ouverture réels, position géographique...), dis-le clairement plutôt que d'inventer une réponse.
- "unclear" : tu ne comprends pas ce qui est demandé, ou il manque des informations essentielles (par exemple "schedule_appointment" sans nom de client identifiable). Dans ce cas, "reply" doit être une question de clarification courte.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"intent": "add_client|schedule_appointment|general_question|unclear", "reply": "phrase courte à dire/afficher à Steve pour confirmer ou répondre", "client": {"name": "", "address": "", "postalCode": "", "city": "", "phone": ""}, "appointment": {"clientName": "", "date": "", "time": ""}}

Inclus "client" uniquement si intent="add_client", "appointment" uniquement si intent="schedule_appointment" (mets l'autre à null). Le "reply" doit toujours être rempli, à la première personne, comme si tu parlais directement à Steve (exemples : "C'est noté, j'ai ajouté Jean Dupont." ou "J'ai programmé Marie Dubois le 14 août à 10h30.").`;

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
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: "user", content: message }],
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
      parsed = { intent: "unclear", reply: "Je n'ai pas compris, pouvez-vous reformuler ?" };
    }

    const validIntents = ["add_client", "schedule_appointment", "general_question", "unclear"];
    const intent = validIntents.includes(parsed.intent) ? parsed.intent : "unclear";
    const reply = typeof parsed.reply === "string" && parsed.reply ? parsed.reply : "Je n'ai pas compris, pouvez-vous reformuler ?";

    return {
      statusCode: 200,
      body: JSON.stringify({
        intent,
        reply,
        client: parsed.client || null,
        appointment: parsed.appointment || null,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Erreur inconnue" }) };
  }
};
