const { withCors } = require("./_cors.js");
const { setDoc } = require("./_firestoreAdmin.js");

const WORKSPACE_ID = "ecosolarnet";
const FIREBASE_PROJECT_ID = "ecosolarnet-54647";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Twilio posts application/x-www-form-urlencoded, not JSON, for WhatsApp webhooks.
exports.handler = withCors(async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const params = new URLSearchParams(event.body || "");
  const from = params.get("From") || ""; // "whatsapp:+3247..."
  const body = params.get("Body") || "";
  const profileName = params.get("ProfileName") || "";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let draftReply = "";
  if (apiKey && body) {
    try {
      const systemPrompt = `Tu es l'assistant de Steve Peters, qui gère ECOSOLARNET, entreprise de nettoyage de vitres, vérandas, pergolas, carports et panneaux solaires à Gerpinnes, en Belgique. Un client vient de lui écrire sur WhatsApp. Rédige un brouillon de réponse courte, professionnelle et chaleureuse en français, à la première personne comme si tu étais Steve. Réponds UNIQUEMENT avec le texte du message, sans guillemets ni commentaire autour.`;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 300,
          system: systemPrompt,
          messages: [{ role: "user", content: `Message du client (${profileName || "numéro inconnu"}) : ${body}` }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const textBlock = (data.content || []).find((b) => b.type === "text");
        draftReply = textBlock?.text || "";
      } else {
        console.error("Anthropic API error", await res.text());
      }
    } catch (err) {
      console.error("AI draft failed", err);
    }
  }

  const id = uid();
  try {
    await setDoc(FIREBASE_PROJECT_ID, `artisans/${WORKSPACE_ID}/whatsappMessages/${id}`, {
      id,
      from,
      profileName,
      body,
      draftReply,
      status: "pending",
      direction: "incoming",
      _syncedAt: Date.now(),
    });
  } catch (err) {
    console.error("Firestore write failed", err);
  }

  // Twilio expects an (optionally empty) TwiML response for the webhook itself.
  return { statusCode: 200, headers: { "content-type": "text/xml" }, body: "<Response></Response>" };
});
