const { withCors } = require("./_cors.js");

function editBase() {
  const env = process.env.SHOTSTACK_ENV === "v1" ? "v1" : "stage";
  return `https://api.shotstack.io/edit/${env}`;
}

const PHOTO_CLIP_SECONDS = 3;
const MAX_VIDEO_SECONDS = 8;

exports.handler = withCors(async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.SHOTSTACK_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Clé Shotstack manquante côté serveur" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { images = [], video = null, videoLength = 0, musicUrl } = payload;
  if (images.length === 0 && !video) {
    return { statusCode: 400, body: JSON.stringify({ error: "Aucun média fourni" }) };
  }
  if (!musicUrl) {
    return { statusCode: 400, body: JSON.stringify({ error: "Musique manquante" }) };
  }

  const clips = [];
  let cursor = 0;
  for (const src of images) {
    clips.push({
      asset: { type: "image", src },
      start: cursor,
      length: PHOTO_CLIP_SECONDS,
      effect: "zoomIn",
      fit: "cover",
    });
    cursor += PHOTO_CLIP_SECONDS;
  }
  if (video) {
    const length = Math.min(Math.max(videoLength || 5, 1), MAX_VIDEO_SECONDS);
    clips.push({
      asset: { type: "video", src: video },
      start: cursor,
      length,
      fit: "cover",
    });
    cursor += length;
  }

  const body = {
    timeline: {
      soundtrack: { src: musicUrl, effect: "fadeInFadeOut", volume: 1 },
      background: "#000000",
      tracks: [{ clips }],
    },
    output: {
      format: "mp4",
      size: { width: 1080, height: 1920 },
    },
  };

  try {
    const res = await fetch(`${editBase()}/render`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: data?.message || "Erreur Shotstack" }) };
    }
    return { statusCode: 200, body: JSON.stringify({ renderId: data.response?.id || data.data?.id }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Erreur inconnue" }) };
  }
});
