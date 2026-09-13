const { withCors } = require("./_cors.js");
const { requireSecret } = require("./_auth.js");
const { getPageToken } = require("./_metaToken.js");

// Résultats des publications Facebook et Instagram d'ECOSOLARNET.
//
// Sert la boucle d'apprentissage du skill "conseiller-social-media" : plutôt que
// de demander à Steve d'aller relever ses chiffres dans Meta Business Suite (ce
// qu'il ne fera jamais, il a un autre métier), on les lit ici et le conseiller
// tient son journal tout seul.
//
// POST { action: "facebook", limite? }   -> derniers posts de la Page + audience
// POST { action: "instagram", limite? }  -> derniers médias du compte Instagram
// POST { action: "tout", limite? }       -> les deux d'un coup (défaut)
//
// Les "insights" (portée, clics) dépendent de la permission read_insights sur le
// jeton de Page. Si elle manque, on renvoie quand même réactions / commentaires /
// partages, qui suffisent à comparer deux publications entre elles — et on le dit
// dans le champ "insightsIndisponibles" plutôt que de laisser croire à un zéro.

const GRAPH = "https://graph.facebook.com/v21.0";
const LIMITE_DEFAUT = 12;
const LIMITE_MAX = 50;

function json(statusCode, body) {
  return { statusCode, body: JSON.stringify(body) };
}

function graphError(data, secours) {
  const err = data && data.error;
  if (!err) return { message: secours };
  return { message: err.message || secours, code: err.code, type: err.type };
}

async function graphGet(token, chemin, params = {}) {
  const url = new URL(GRAPH + chemin);
  for (const [cle, valeur] of Object.entries(params)) {
    if (valeur !== undefined && valeur !== null) url.searchParams.set(cle, String(valeur));
  }
  url.searchParams.set("access_token", token);
  try {
    const res = await fetch(url, { method: "GET" });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && !data.error, data };
  } catch (e) {
    return { ok: false, data: { error: { message: e.message } } };
  }
}

// Les insights peuvent être refusés (permission) ou absents (post trop récent,
// métrique retirée par Meta). Aucun de ces cas ne doit faire échouer la lecture.
async function insights(token, id, metriques) {
  const res = await graphGet(token, `/${id}/insights`, { metric: metriques.join(",") });
  if (!res.ok) return { valeurs: null, erreur: graphError(res.data, "insights indisponibles") };
  const valeurs = {};
  for (const entree of res.data.data || []) {
    const v = entree.values && entree.values[0];
    if (v && typeof v.value === "number") valeurs[entree.name] = v.value;
  }
  return { valeurs, erreur: null };
}

// Trois routes lisent les publications d'une Page, et elles n'exigent pas les mêmes
// permissions : /me/published_posts se contente de pages_read_engagement, alors que
// /me/posts réclame pages_read_user_content parce qu'il inclut aussi ce que des tiers
// ont publié sur la Page. On prend la première qui répond.
const ROUTES_POSTS = ["/me/published_posts", "/me/feed", "/me/posts"];

async function lireFacebook(token, limite) {
  const champs = [
    "id",
    "created_time",
    "message",
    "permalink_url",
    "full_picture",
    "shares",
    "reactions.summary(true).limit(0)",
    "comments.summary(true).limit(0)",
  ].join(",");

  let posts = null;
  for (const route of ROUTES_POSTS) {
    posts = await graphGet(token, route, { limit: limite, fields: champs });
    if (posts.ok) break;
  }

  if (!posts.ok) {
    return { erreur: graphError(posts.data, "lecture des publications impossible") };
  }

  let insightsRefuses = null;

  const publications = await Promise.all(
    (posts.data.data || []).map(async (p) => {
      const stat = await insights(token, p.id, [
        "post_impressions_unique",
        "post_engaged_users",
        "post_clicks",
      ]);
      if (stat.erreur && !insightsRefuses) insightsRefuses = stat.erreur.message;
      return {
        id: p.id,
        date: p.created_time,
        lien: p.permalink_url || null,
        image: p.full_picture || null,
        // Le texte sert à reconnaître la publication dans le journal, pas à l'analyser.
        debutTexte: p.message ? p.message.slice(0, 120) : null,
        reactions: (p.reactions && p.reactions.summary && p.reactions.summary.total_count) || 0,
        commentaires: (p.comments && p.comments.summary && p.comments.summary.total_count) || 0,
        partages: (p.shares && p.shares.count) || 0,
        portee: stat.valeurs ? stat.valeurs.post_impressions_unique ?? null : null,
        interactions: stat.valeurs ? stat.valeurs.post_engaged_users ?? null : null,
        clics: stat.valeurs ? stat.valeurs.post_clicks ?? null : null,
      };
    })
  );

  const page = await graphGet(token, "/me", { fields: "id,name,fan_count,followers_count" });

  return {
    page: page.ok ? page.data : null,
    publications,
    insightsIndisponibles: insightsRefuses,
  };
}

async function lireInstagram(token, limite) {
  const lien = await graphGet(token, "/me", { fields: "instagram_business_account{id,username,followers_count}" });
  const compte = lien.ok && lien.data.instagram_business_account;
  if (!compte || !compte.id) {
    return { compte: null, publications: [], erreur: "Aucun compte Instagram professionnel relié à la Page" };
  }

  const medias = await graphGet(token, `/${compte.id}/media`, {
    limit: limite,
    fields: "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count",
  });

  if (!medias.ok) {
    return { compte, publications: [], erreur: graphError(medias.data, "lecture des médias impossible").message };
  }

  let insightsRefuses = null;

  const publications = await Promise.all(
    (medias.data.data || []).map(async (m) => {
      const stat = await insights(token, m.id, ["reach", "saved", "shares"]);
      if (stat.erreur && !insightsRefuses) insightsRefuses = stat.erreur.message;
      return {
        id: m.id,
        date: m.timestamp,
        type: m.media_product_type || m.media_type,
        lien: m.permalink || null,
        debutTexte: m.caption ? m.caption.slice(0, 120) : null,
        jaime: m.like_count ?? 0,
        commentaires: m.comments_count ?? 0,
        portee: stat.valeurs ? stat.valeurs.reach ?? null : null,
        enregistrements: stat.valeurs ? stat.valeurs.saved ?? null : null,
        partages: stat.valeurs ? stat.valeurs.shares ?? null : null,
      };
    })
  );

  return { compte, publications, insightsIndisponibles: insightsRefuses };
}

exports.handler = withCors(requireSecret(async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload = {};
  if (event.body) {
    try {
      payload = JSON.parse(event.body);
    } catch {
      return json(400, { error: "JSON invalide" });
    }
  }

  const action = payload.action || "tout";
  const limite = Math.min(Number(payload.limite) || LIMITE_DEFAUT, LIMITE_MAX);

  const token = await getPageToken();
  if (!token) {
    return json(500, { error: "Jeton de Page manquant — lancer meta-token-setup" });
  }

  // Quand rien ne remonte, la question est toujours la même : quelle route passe, et
  // laquelle est refusée pour quelle permission ? Cette action répond sans toucher
  // au jeton ni rien publier.
  if (action === "diagnostic") {
    const routes = {};
    for (const route of ROUTES_POSTS) {
      const res = await graphGet(token, route, { limit: 1, fields: "id,created_time" });
      routes[route] = res.ok
        ? { ok: true, publications: (res.data.data || []).length }
        : { ok: false, erreur: graphError(res.data, "refus sans message") };
    }
    return json(200, { version: "routes-fallback", routes });
  }

  if (action === "facebook") return json(200, { facebook: await lireFacebook(token, limite) });
  if (action === "instagram") return json(200, { instagram: await lireInstagram(token, limite) });
  if (action !== "tout") return json(400, { error: `Action inconnue : ${action}` });

  const [facebook, instagram] = await Promise.all([
    lireFacebook(token, limite),
    lireInstagram(token, limite),
  ]);
  return json(200, { facebook, instagram });
}));
