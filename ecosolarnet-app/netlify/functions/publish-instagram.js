const { withCors } = require("./_cors.js");
const { requireSecret } = require("./_auth.js");
const { getPageToken } = require("./_metaToken.js");

// Publie sur le compte Instagram rattaché à la Page ECOSOLARNET.
//
// Instagram ne publie pas en un appel comme Facebook : il faut déposer le média
// dans un "conteneur", attendre qu'Instagram l'ait transcodé, puis demander la
// publication. Ce transcodage dure souvent plus longtemps que le délai maximal
// d'une fonction Netlify — d'où les trois actions séparées, l'attente se faisant
// côté appelant.
//
// POST { action: "compte" }                        -> identité du compte Instagram
// POST { action: "creer", videoUrl | photoUrl | photoUrls[], message } -> crée le conteneur, renvoie son id
// POST { action: "etat", creationId }              -> où en est le transcodage
// POST { action: "publier", creationId }           -> publie et renvoie le lien

const GRAPH = "https://graph.facebook.com/v21.0";

function json(statusCode, body) {
  return { statusCode, body: JSON.stringify(body) };
}

function graphError(data, secours) {
  const err = data && data.error;
  if (!err) return { message: secours };
  return { message: err.message || secours, code: err.code, type: err.type };
}

async function graph(token, chemin, { method = "POST", params = {} } = {}) {
  const url = new URL(`${GRAPH}${chemin}`);
  const recherche = new URLSearchParams({ ...params, access_token: token });
  let body;
  if (method === "GET") {
    for (const [k, v] of recherche) url.searchParams.set(k, v);
  } else {
    body = recherche;
  }
  const res = await fetch(url, { method, body });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && !data.error, data };
}

// L'identifiant Instagram se lit depuis la Page : c'est elle qui porte le rattachement.
async function compteInstagram(token) {
  const res = await graph(token, "/me", {
    method: "GET",
    params: { fields: "instagram_business_account{id,username,followers_count}" },
  });
  if (!res.ok) return { erreur: graphError(res.data, "lecture impossible") };
  const compte = res.data.instagram_business_account;
  if (!compte) {
    return { erreur: { message: "Aucun compte Instagram rattaché à la Page" } };
  }
  return { compte };
}

exports.handler = withCors(requireSecret(async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "JSON invalide" });
  }

  const token = await getPageToken();
  if (!token) return json(500, { error: "Jeton de Page manquant" });

  const { compte, erreur } = await compteInstagram(token);
  if (erreur) return json(502, { error: erreur.message, detail: erreur });

  if (payload.action === "compte") {
    return json(200, { compte });
  }

  if (payload.action === "creer") {
    const { videoUrl, photoUrl, message } = payload;
    const photoUrls = Array.isArray(payload.photoUrls) ? payload.photoUrls.filter(Boolean) : [];

    // Carrousel : chaque photo devient un conteneur "enfant", puis un conteneur
    // parent les rassemble. Instagram en accepte de 2 à 10.
    if (photoUrls.length > 1) {
      const enfants = [];
      for (const url of photoUrls) {
        const res = await graph(token, `/${compte.id}/media`, {
          params: { image_url: url, is_carousel_item: "true" },
        });
        if (!res.ok || !res.data.id) {
          return json(502, {
            error: "Création d'une image du carrousel refusée",
            detail: graphError(res.data, "échec"),
            photo: url,
          });
        }
        enfants.push(res.data.id);
      }

      const parent = await graph(token, `/${compte.id}/media`, {
        params: {
          media_type: "CAROUSEL",
          children: enfants.join(","),
          caption: typeof message === "string" ? message : "",
        },
      });
      if (!parent.ok || !parent.data.id) {
        return json(502, { error: "Création du carrousel refusée", detail: graphError(parent.data, "échec") });
      }
      return json(200, { creationId: parent.data.id, images: enfants.length });
    }

    if (!videoUrl && !photoUrl) return json(400, { error: "videoUrl, photoUrl ou photoUrls requis" });

    // Une photo se dépose en conteneur IMAGE, sans transcodage : elle est prête
    // presque tout de suite. Une vidéo verticale passe par le format Reels — le
    // type VIDEO classique n'est plus accepté pour le fil Instagram.
    const media = photoUrl
      ? { image_url: photoUrl }
      : { media_type: "REELS", video_url: videoUrl, share_to_feed: "true" };

    const res = await graph(token, `/${compte.id}/media`, {
      params: {
        ...media,
        caption: typeof message === "string" ? message : "",
      },
    });
    if (!res.ok) {
      return json(502, { error: "Création refusée", detail: graphError(res.data, "échec") });
    }
    return json(200, { creationId: res.data.id });
  }

  if (payload.action === "etat") {
    const { creationId } = payload;
    if (!creationId) return json(400, { error: "creationId requis" });
    const res = await graph(token, `/${creationId}`, {
      method: "GET",
      params: { fields: "status_code,status" },
    });
    if (!res.ok) {
      return json(502, { error: "État illisible", detail: graphError(res.data, "échec") });
    }
    return json(200, { statut: res.data.status_code, detail: res.data.status || null });
  }

  if (payload.action === "publier") {
    const { creationId } = payload;
    if (!creationId) return json(400, { error: "creationId requis" });

    const res = await graph(token, `/${compte.id}/media_publish`, {
      params: { creation_id: creationId },
    });
    if (!res.ok) {
      return json(502, { error: "Publication refusée", detail: graphError(res.data, "échec") });
    }

    const lien = await graph(token, `/${res.data.id}`, {
      method: "GET",
      params: { fields: "permalink" },
    });
    return json(200, {
      ok: true,
      id: res.data.id,
      url: lien.ok ? lien.data.permalink : null,
    });
  }

  return json(400, { error: `Action inconnue : ${payload.action}` });
}));
