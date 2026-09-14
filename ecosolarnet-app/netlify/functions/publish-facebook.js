const { withCors } = require("./_cors.js");
const { requireSecret } = require("./_auth.js");
const { getPageToken } = require("./_metaToken.js");

// Publie sur la Page Facebook ECOSOLARNET. Le jeton vient de _metaToken.js
// (Firestore, sinon variable d'environnement) et ne sort jamais d'ici : ni dans les
// réponses, ni dans les logs. L'appelant déclenche, il ne détient rien.
//
// POST { action: "check" }
//   Vérifie l'identité de la Page et le droit de publier, sans rien rendre public :
//   on crée une publication NON publiée puis on la supprime aussitôt.
//
// POST { action: "publish", message, photoBase64?, photoUrl?, photoUrls?, videoUrl?, scheduledPublishTime? }
//   photoUrls : plusieurs photos -> une publication qui les porte toutes
//   scheduledPublishTime : horodatage Unix en secondes pour une parution différée
//   - photoBase64 : une photo encodée en base64 (sans en-tête "data:")
//   - photoUrl / videoUrl : un média accessible publiquement par URL
//   - sans média : simple publication texte

const GRAPH = "https://graph.facebook.com/v21.0";

function json(statusCode, body) {
  return { statusCode, body: JSON.stringify(body) };
}

// Les erreurs Graph sont verbeuses et peuvent contenir des identifiants internes :
// on ne remonte que le message et le code, jamais la réponse brute.
function graphError(data, fallback) {
  const err = data && data.error;
  if (!err) return { message: fallback };
  return {
    message: err.message || fallback,
    code: err.code,
    subcode: err.error_subcode,
    type: err.type,
  };
}

async function graph(token, path, { method = "POST", params = {}, form = null } = {}) {
  const url = new URL(`${GRAPH}${path}`);
  let body;

  if (form) {
    form.append("access_token", token);
    body = form;
  } else {
    const search = new URLSearchParams({ ...params, access_token: token });
    if (method === "GET" || method === "DELETE") {
      for (const [k, v] of search) url.searchParams.set(k, v);
    } else {
      body = search;
    }
  }

  const res = await fetch(url, { method, body });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && !data.error, data };
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

  const action = payload.action || "publish";

  const token = await getPageToken();
  if (!token) {
    return json(500, { error: "Jeton de Page manquant — lancer meta-token-setup" });
  }

  // --- Diagnostic ---------------------------------------------------------
  if (action === "check") {
    const me = await graph(token, "/me", { method: "GET", params: { fields: "id,name,category" } });
    if (!me.ok) {
      return json(502, { error: "Jeton invalide", detail: graphError(me.data, "identité illisible") });
    }

    // Un brouillon non publié : rien n'apparaît sur la Page, et ça suffit à
    // savoir si la permission d'écriture est accordée.
    const draft = await graph(token, "/me/feed", {
      params: { message: "Test technique ECOSOLARNET", published: "false" },
    });

    if (!draft.ok) {
      return json(200, {
        page: me.data,
        canPublish: false,
        detail: graphError(draft.data, "publication refusée"),
      });
    }

    if (draft.data.id) await graph(token, `/${draft.data.id}`, { method: "DELETE" });
    return json(200, { page: me.data, canPublish: true });
  }

  // --- Informations de la Page --------------------------------------------
  // Sert notamment à récupérer la couverture et la photo de profil telles que
  // Steve les a mises depuis son téléphone, sans lui demander de les transférer.
  if (action === "infos") {
    const infos = await graph(token, "/me", {
      method: "GET",
      params: { fields: "id,name,category,fan_count,link,cover{source},picture.width(720){url},about,phone,website" },
    });
    if (!infos.ok) {
      return json(502, { error: "Lecture impossible", detail: graphError(infos.data, "échec") });
    }
    // Le compte Instagram se demande à part : sans l'autorisation instagram_basic,
    // Graph rejette toute la requête si le champ y figure. Isolé, son échec
    // devient une information utile au lieu de tout faire tomber.
    const insta = await graph(token, "/me", {
      method: "GET",
      params: { fields: "instagram_business_account{id,username,followers_count},connected_instagram_account{id,username}" },
    });

    return json(200, {
      ...infos.data,
      instagram: insta.ok ? insta.data : { erreur: graphError(insta.data, "illisible") },
    });
  }

  // --- Publication --------------------------------------------------------
  if (action !== "publish") {
    return json(400, { error: `Action inconnue : ${action}` });
  }

  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  const { photoBase64, photoUrl, videoUrl } = payload;

  // Publication différée : Facebook accepte une date de parution entre 10 minutes
  // et 6 mois. On la passe telle quelle à Graph, qui refusera une date hors bornes.
  // Steve peut annuler ou modifier depuis Meta Business Suite jusqu'à la parution.
  const quand = Number(payload.scheduledPublishTime) || null;
  const differe = quand ? { published: "false", scheduled_publish_time: String(quand) } : {};

  if (!message && !photoBase64 && !photoUrl && !videoUrl && !(Array.isArray(payload.photoUrls) && payload.photoUrls.length)) {
    return json(400, { error: "Rien à publier" });
  }

  let result;

  // Plusieurs photos : Facebook n'a pas de route "carrousel". On dépose chaque
  // photo sans la publier, ce qui donne un identifiant par image, puis on crée
  // une publication qui les porte toutes.
  const photoUrls = Array.isArray(payload.photoUrls) ? payload.photoUrls.filter(Boolean) : [];

  if (photoUrls.length > 1) {
    const ids = [];
    for (const url of photoUrls) {
      const depot = await graph(token, "/me/photos", {
        params: { url, published: "false", temporary: "true" },
      });
      if (!depot.ok || !depot.data.id) {
        return json(502, {
          error: "Dépôt d'une photo refusé",
          detail: graphError(depot.data, "échec"),
          photo: url,
        });
      }
      ids.push(depot.data.id);
    }

    const params = { message, ...differe };
    ids.forEach((id, rang) => {
      params[`attached_media[${rang}]`] = JSON.stringify({ media_fbid: id });
    });
    result = await graph(token, "/me/feed", { params });
  } else if (videoUrl) {
    result = await graph(token, "/me/videos", {
      params: { file_url: videoUrl, description: message, ...differe },
    });
  } else if (photoBase64) {
    // Une photo envoyée en base64 pèse un tiers de plus que le fichier d'origine,
    // et Netlify coupe les requêtes au-delà de ~6 Mo : au-delà, passer par photoUrl.
    const buffer = Buffer.from(photoBase64, "base64");
    if (buffer.length > 4_500_000) {
      return json(413, { error: "Photo trop lourde pour cet envoi — utiliser photoUrl" });
    }
    const form = new FormData();
    form.append("source", new Blob([buffer], { type: "image/jpeg" }), "photo.jpg");
    if (message) form.append("caption", message);
    for (const [cle, valeur] of Object.entries(differe)) form.append(cle, valeur);
    result = await graph(token, "/me/photos", { form });
  } else if (photoUrl) {
    result = await graph(token, "/me/photos", { params: { url: photoUrl, caption: message, ...differe } });
  } else {
    result = await graph(token, "/me/feed", { params: { message, ...differe } });
  }

  if (!result.ok) {
    return json(502, {
      error: "Publication refusée par Facebook",
      detail: graphError(result.data, "erreur inconnue"),
    });
  }

  const id = result.data.post_id || result.data.id;
  return json(200, {
    ok: true,
    id,
    // Une publication différée n'a pas encore d'adresse publique : le lien ne vaut
    // qu'une fois qu'elle est parue.
    url: id && !quand ? `https://www.facebook.com/${id}` : null,
    programmeePour: quand ? new Date(quand * 1000).toISOString() : null,
  });
}));
