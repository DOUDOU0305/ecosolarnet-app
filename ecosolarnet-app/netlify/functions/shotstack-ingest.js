const { withCors } = require("./_cors.js");

function ingestBase() {
  const env = process.env.SHOTSTACK_ENV === "v1" ? "v1" : "stage";
  return `https://api.shotstack.io/ingest/${env}`;
}

exports.handler = withCors(async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.SHOTSTACK_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Clé Shotstack manquante côté serveur" }) };
  }

  try {
    const res = await fetch(`${ingestBase()}/upload`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: data?.message || "Erreur Shotstack" }) };
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ uploadUrl: data.data.attributes.url, sourceId: data.data.id }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Erreur inconnue" }) };
  }
});
