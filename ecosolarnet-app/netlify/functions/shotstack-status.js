const { withCors } = require("./_cors.js");

function bases() {
  const env = process.env.SHOTSTACK_ENV === "v1" ? "v1" : "stage";
  return {
    ingest: `https://api.shotstack.io/ingest/${env}`,
    edit: `https://api.shotstack.io/edit/${env}`,
  };
}

exports.handler = withCors(async function handler(event) {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.SHOTSTACK_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Clé Shotstack manquante côté serveur" }) };
  }

  const { type, id } = event.queryStringParameters || {};
  if (!id || (type !== "source" && type !== "render")) {
    return { statusCode: 400, body: JSON.stringify({ error: "Paramètres invalides" }) };
  }

  const url = type === "source" ? `${bases().ingest}/sources/${id}` : `${bases().edit}/render/${id}`;

  try {
    const res = await fetch(url, { headers: { "x-api-key": apiKey, accept: "application/json" } });
    const data = await res.json();
    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: data?.message || "Erreur Shotstack" }) };
    }
    // The Ingest API (source upload status) uses a JSON:API-style envelope
    // (data.attributes); the Edit/Render API uses a different, older shape
    // (response.*) — these are genuinely two separate Shotstack APIs, not an
    // inconsistency in this code. They also name the output link differently:
    // ingest sources expose it as "source", renders expose it as "url".
    const attrs = type === "source" ? data.data?.attributes || {} : data.response || {};
    const outputUrl = type === "source" ? attrs.source : attrs.url;
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: attrs.status || "unknown",
        url: outputUrl || null,
        error: attrs.error || null,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Erreur inconnue" }) };
  }
});
