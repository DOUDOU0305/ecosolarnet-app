const crypto = require("crypto");
const { withCors } = require("./_cors.js");
const { setDoc } = require("./_firestoreAdmin.js");

const WORKSPACE_ID = "ecosolarnet";
const FIREBASE_PROJECT_ID = "ecosolarnet-54647";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Même texte fixe que pour les emails/WhatsApp — voir la note dans
// whatsapp-webhook.js : ni chiffré ni généré par l'IA, exprès.
const AUTO_DEVIS_REPLY = `Bonjour,

J'ai bien reçu votre demande de devis et vous en remercie. J'aurais besoin de votre nom, prénom, mail, adresse où aura lieu le nettoyage. Je reviens au plus vite vers vous.

Bien à vous,
Steve PETERS`;

// Garantit que la requête vient bien de Meta (et pas de n'importe qui ayant
// deviné cette adresse) — signature calculée sur le corps BRUT de la requête
// avec l'App Secret. https://developers.facebook.com/docs/messenger-platform/webhooks#security
function validateMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

async function classifyMessage(body) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !body) return { category: "autre", reply: "" };

  const systemPrompt = `Tu aides Steve Peters, artisan indépendant qui gère "ECOSOLARNET", entreprise de nettoyage de vitres, vérandas, pergolas, carports et panneaux solaires à Gerpinnes, en Belgique. Un client vient de lui écrire sur Messenger, via sa page Facebook professionnelle.

Classe le message dans une seule de ces catégories :
- "spam" : publicité, arnaque, message non sollicité sans rapport avec le métier.
- "devis" : le client demande un prix ou un devis pour une prestation.
- "rendezvous" : le client demande ou confirme un rendez-vous ou une date d'intervention.
- "renseignement" : question générale sur les services, zones couvertes, disponibilités.
- "autre" : tout le reste (ne pas générer de réponse).

Si la catégorie est "rendezvous" ou "renseignement", rédige un brouillon de réponse court en français, sur Messenger donc familier et direct (pas une mise en page email formelle), à la première personne comme si tu étais Steve. Steve donne toujours ses devis en se déplaçant sur place, jamais par écrit à distance : ne chiffre jamais, ne demande jamais de détails techniques (nombre de fenêtres, étages, surface...), et ne propose jamais de devis "adapté" sans visite. Si une adresse ou un rendez-vous est nécessaire et pas encore donné, demande-le simplement.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"category": "spam|devis|rendezvous|renseignement|autre", "reply": "texte du brouillon ou chaîne vide si non applicable"}`;

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
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: "user", content: body }],
      }),
    });
    if (!res.ok) {
      console.error("Anthropic API error", await res.text());
      return { category: "autre", reply: "" };
    }
    const data = await res.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    const text = textBlock?.text || "{}";
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text);
    const validCategories = ["spam", "devis", "rendezvous", "renseignement", "autre"];
    return {
      category: validCategories.includes(parsed.category) ? parsed.category : "autre",
      reply: typeof parsed.reply === "string" ? parsed.reply : "",
    };
  } catch (err) {
    console.error("AI classification failed", err);
    return { category: "autre", reply: "" };
  }
}

async function sendMessengerReply(psid, text) {
  const pageAccessToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  if (!pageAccessToken) throw new Error("Configuration Messenger manquante");

  const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: psid }, message: { text } }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || "Erreur Messenger");
  }
}

// Nom affiché à la place du PSID (identifiant technique illisible) — best
// effort, échoue silencieusement si l'appel Graph API ne passe pas.
async function fetchSenderName(psid) {
  const pageAccessToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  if (!pageAccessToken) return "";
  try {
    const res = await fetch(`https://graph.facebook.com/${psid}?fields=first_name,last_name&access_token=${encodeURIComponent(pageAccessToken)}`);
    if (!res.ok) return "";
    const data = await res.json();
    return [data.first_name, data.last_name].filter(Boolean).join(" ");
  } catch {
    return "";
  }
}

exports.handler = withCors(async function handler(event) {
  // Meta appelle cette adresse en GET une seule fois, à la configuration du
  // webhook, pour vérifier qu'on la contrôle bien avant de l'activer.
  if (event.httpMethod === "GET") {
    const params = event.queryStringParameters || {};
    const verifyToken = process.env.MESSENGER_VERIFY_TOKEN;
    if (params["hub.mode"] === "subscribe" && params["hub.verify_token"] === verifyToken) {
      return { statusCode: 200, body: params["hub.challenge"] || "" };
    }
    return { statusCode: 403, body: "Forbidden" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
  const signature = event.headers["x-hub-signature-256"] || event.headers["X-Hub-Signature-256"];
  const appSecret = process.env.MESSENGER_APP_SECRET;
  if (!appSecret || !validateMetaSignature(rawBody, signature, appSecret)) {
    console.error("[messenger-webhook] signature Meta invalide ou absente — requête rejetée");
    return { statusCode: 403, body: "Forbidden" };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 200, body: "EVENT_RECEIVED" };
  }

  for (const entry of payload.entry || []) {
    for (const event_ of entry.messaging || []) {
      const psid = event_.sender?.id;
      const body = event_.message?.text;
      // Ignore les accusés de lecture, "typing", messages sans texte
      // (images seules, etc.) et les échos de nos propres envois.
      if (!psid || !body || event_.message?.is_echo) continue;

      const { category, reply } = await classifyMessage(body);
      const senderName = await fetchSenderName(psid);
      const id = uid();

      try {
        if (category === "spam") {
          await setDoc(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/messengerMessages/${id}`, {
            id, psid, senderName, body, category,
            draftReply: "", status: "ignored", direction: "incoming", _syncedAt: Date.now(),
          });
        } else if (category === "devis") {
          try {
            await sendMessengerReply(psid, AUTO_DEVIS_REPLY);
            await setDoc(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/messengerMessages/${id}`, {
              id, psid, senderName, body, category,
              draftReply: AUTO_DEVIS_REPLY, status: "sent", sentBody: AUTO_DEVIS_REPLY,
              sentAt: Date.now(), sentAuto: true, direction: "incoming", _syncedAt: Date.now(),
            });
          } catch (sendErr) {
            console.error("Auto-send failed", sendErr);
            await setDoc(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/messengerMessages/${id}`, {
              id, psid, senderName, body, category,
              draftReply: AUTO_DEVIS_REPLY, status: "pending", direction: "incoming", _syncedAt: Date.now(),
            });
          }
        } else {
          await setDoc(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/messengerMessages/${id}`, {
            id, psid, senderName, body, category,
            draftReply: reply, status: "pending", direction: "incoming", _syncedAt: Date.now(),
          });
        }
      } catch (err) {
        console.error("Firestore write failed", err);
      }
    }
  }

  return { statusCode: 200, body: "EVENT_RECEIVED" };
});
