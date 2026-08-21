const { withCors } = require("./_cors.js");
const { requireSecret } = require("./_auth.js");

exports.handler = withCors(requireSecret(async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }
  const { psid, body } = payload;
  if (!psid || !body) {
    return { statusCode: 400, body: JSON.stringify({ error: "psid et body requis" }) };
  }

  const pageAccessToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  if (!pageAccessToken) {
    return { statusCode: 500, body: JSON.stringify({ error: "Configuration Messenger manquante côté serveur" }) };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipient: { id: psid }, message: { text: body } }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: data.error?.message || "Erreur Messenger" }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}));
