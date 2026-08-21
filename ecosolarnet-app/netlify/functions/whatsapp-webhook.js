const crypto = require("crypto");
const { withCors } = require("./_cors.js");
const { setDoc } = require("./_firestoreAdmin.js");

const WORKSPACE_ID = "ecosolarnet";
const FIREBASE_PROJECT_ID = "ecosolarnet-54647";
// Doit correspondre EXACTEMENT à l'URL configurée dans Twilio (Sandbox
// Settings → "WHEN A MESSAGE COMES IN") — la validation de signature en
// dépend, une URL différente ferait échouer la vérification même pour de
// vrais messages Twilio.
const WEBHOOK_URL = "https://frabjous-treacle-60d239.netlify.app/.netlify/functions/whatsapp-webhook";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Garantit que la requête vient bien de Twilio (et pas de n'importe qui
// ayant deviné cette adresse) — sans ça, n'importe qui pourrait déclencher
// de faux "devis" auto-envoyés ou faire tourner l'IA à volonté à nos frais.
// Algorithme officiel Twilio : https://www.twilio.com/docs/usage/webhooks/webhooks-security
function validateTwilioSignature(url, params, signature, authToken) {
  if (!signature) return false;
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];
  const expected = crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// Même texte fixe que pour les emails (js/views/emails.js) — ni chiffré ni
// généré par l'IA, exprès : Steve donne toujours ses devis sur place, jamais
// à distance sur base d'un nombre de fenêtres/étages annoncé par le client.
// Si ce texte change d'un côté, penser à le répercuter de l'autre.
const AUTO_DEVIS_REPLY = `Bonjour,

J'ai bien reçu votre demande de devis et vous en remercie. J'aurais besoin de votre nom, prénom, mail, adresse où aura lieu le nettoyage. Je reviens au plus vite vers vous.

Bien à vous,
Steve PETERS`;

async function classifyMessage(body) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !body) return { category: "autre", reply: "" };

  const systemPrompt = `Tu aides Steve Peters, artisan indépendant qui gère "ECOSOLARNET", entreprise de nettoyage de vitres, vérandas, pergolas, carports et panneaux solaires à Gerpinnes, en Belgique. Un client vient de lui écrire sur WhatsApp.

Classe le message dans une seule de ces catégories :
- "spam" : publicité, arnaque, message non sollicité sans rapport avec le métier.
- "devis" : le client demande un prix ou un devis pour une prestation.
- "rendezvous" : le client demande ou confirme un rendez-vous ou une date d'intervention.
- "renseignement" : question générale sur les services, zones couvertes, disponibilités.
- "autre" : tout le reste (ne pas générer de réponse).

Si la catégorie est "rendezvous" ou "renseignement", rédige un brouillon de réponse court en français, sur WhatsApp donc familier et direct (pas une mise en page email formelle), à la première personne comme si tu étais Steve. Steve donne toujours ses devis en se déplaçant sur place, jamais par écrit à distance : ne chiffre jamais, ne demande jamais de détails techniques (nombre de fenêtres, étages, surface...), et ne propose jamais de devis "adapté" sans visite. Si une adresse ou un rendez-vous est nécessaire et pas encore donné, demande-le simplement.

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

// Même message convient pour vitres, vérandas, corniches et panneaux
// solaires (confirmé par Steve) — pas besoin de distinguer par service.
async function sendWhatsAppReply(to, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!accountSid || !authToken || !fromNumber) throw new Error("Configuration Twilio manquante");

  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const params = new URLSearchParams({ From: fromNumber, To: to, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth}`, "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Erreur Twilio");
  }
}

// Twilio posts application/x-www-form-urlencoded, not JSON, for WhatsApp webhooks.
exports.handler = withCors(async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const params = new URLSearchParams(event.body || "");
  const signature = event.headers["x-twilio-signature"] || event.headers["X-Twilio-Signature"];
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !validateTwilioSignature(WEBHOOK_URL, Object.fromEntries(params.entries()), signature, authToken)) {
    console.error("[whatsapp-webhook] signature Twilio invalide ou absente — requête rejetée");
    return { statusCode: 403, body: "Forbidden" };
  }

  const from = params.get("From") || ""; // "whatsapp:+3247..."
  const body = params.get("Body") || "";
  const profileName = params.get("ProfileName") || "";

  const { category, reply } = await classifyMessage(body);

  const id = uid();
  try {
    if (category === "spam") {
      await setDoc(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/whatsappMessages/${id}`, {
        id,
        from,
        profileName,
        body,
        category,
        draftReply: "",
        status: "ignored",
        direction: "incoming",
        _syncedAt: Date.now(),
      });
    } else if (category === "devis") {
      // Envoyé directement, sans validation — Steve l'a explicitement demandé
      // pour ce cas précis (message générique, sans risque puisqu'il ne
      // chiffre ni n'engage à rien). Si l'envoi Twilio échoue pour une
      // raison quelconque, on retombe sur un brouillon à valider plutôt que
      // de perdre la demande.
      try {
        await sendWhatsAppReply(from, AUTO_DEVIS_REPLY);
        await setDoc(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/whatsappMessages/${id}`, {
          id,
          from,
          profileName,
          body,
          category,
          draftReply: AUTO_DEVIS_REPLY,
          status: "sent",
          sentBody: AUTO_DEVIS_REPLY,
          sentAt: Date.now(),
          sentAuto: true,
          direction: "incoming",
          _syncedAt: Date.now(),
        });
      } catch (sendErr) {
        console.error("Auto-send failed", sendErr);
        await setDoc(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/whatsappMessages/${id}`, {
          id,
          from,
          profileName,
          body,
          category,
          draftReply: AUTO_DEVIS_REPLY,
          status: "pending",
          direction: "incoming",
          _syncedAt: Date.now(),
        });
      }
    } else {
      // "rendezvous" (déplacement/changement de RDV), "renseignement" ou
      // "autre" : on garde la catégorie pour que le debriefing du matin
      // puisse citer nommément les demandes de déplacement de rendez-vous
      // plutôt que de les noyer dans un compte générique.
      await setDoc(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/whatsappMessages/${id}`, {
        id,
        from,
        profileName,
        body,
        category,
        draftReply: reply,
        status: "pending",
        direction: "incoming",
        _syncedAt: Date.now(),
      });
    }
  } catch (err) {
    console.error("Firestore write failed", err);
  }

  // Twilio expects an (optionally empty) TwiML response for the webhook itself.
  return { statusCode: 200, headers: { "content-type": "text/xml" }, body: "<Response></Response>" };
});
