const { withCors } = require("./_cors.js");
const { requireSecret } = require("./_auth.js");

function editBase() {
  const env = process.env.SHOTSTACK_ENV === "v1" ? "v1" : "stage";
  return `https://api.shotstack.io/edit/${env}`;
}

// 5 secondes par photo, c'est long : l'œil a tout vu au bout de deux. On enchaîne
// plus vite, avec un fondu entre les plans pour que la coupe ne soit pas sèche.
const PHOTO_CLIP_SECONDS = 3.5;
const TRANSITION = 0.4;

// Le format décide du cadrage. Une publication au fil Facebook gagne à être en 4:5,
// le plus haut qu'il accepte d'afficher en entier ; une story ou un Reel veut du 9:16.
const FORMATS = {
  publication: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};
const MAX_VIDEO_SECONDS = 12;

exports.handler = withCors(requireSecret(async function handler(event) {
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

  const { images = [], video = null, videoLength = 0, musicUrl, format = "publication" } = payload;
  const taille = FORMATS[format] || FORMATS.publication;
  if (images.length === 0 && !video) {
    return { statusCode: 400, body: JSON.stringify({ error: "Aucun média fourni" }) };
  }
  if (!musicUrl) {
    return { statusCode: 400, body: JSON.stringify({ error: "Musique manquante" }) };
  }

  const clips = [];
  let cursor = 0;
  images.forEach((src, index) => {
    clips.push({
      asset: { type: "image", src },
      start: cursor,
      length: PHOTO_CLIP_SECONDS,
      // On alterne le sens du zoom : trois plans qui avancent tous de la même
      // façon donnent une impression de diaporama mécanique.
      effect: index % 2 === 0 ? "zoomIn" : "zoomOut",
      fit: "cover",
      transition: {
        in: index === 0 ? "fade" : "fade",
        out: "fade",
      },
    });
    cursor += PHOTO_CLIP_SECONDS - (index < images.length - 1 ? TRANSITION : 0);
  });
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
      size: taille,
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
}));