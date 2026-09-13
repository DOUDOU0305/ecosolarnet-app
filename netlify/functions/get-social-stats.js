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

// Les insights peuvent être refusés (permission), absents (post trop récent) ou porter
// un nom que Meta a retiré d'une version à l'autre — et une seule métrique invalide fait
// échouer tout le lot. Aucun de ces cas ne doit faire échouer la lecture.
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

// Meta retire régulièrement des métriques. Plutôt que de figer une liste qui cassera
// silencieusement, on demande le lot une fois ; s'il est refusé, on teste chaque
// métrique séparément et on retient celles qui répondent, pour toutes les publications
// suivantes de la même lecture.
async function metriquesValides(token, id, candidates) {
  const lot = await insights(token, id, candidates);
  if (lot.valeurs) return { retenues: candidates, erreur: null };

  const retenues = [];
  for (const m of candidates) {
    const essai = await insights(token, id, [m]);
    if (essai.valeurs) retenues.push(m);
  }
  return { retenues, erreur: retenues.length ? null : lot.erreur };
}

// Trois routes lisent les publications d'une Page, et elles n'exigent pas les mêmes
// permissions : /me/published_posts se contente de pages_read_engagement, alors que
// /me/feed et /me/posts en réclament d'autres parce qu'ils incluent aussi ce que des
// tiers ont publié sur la Page. On prend la première qui répond.
const ROUTES_POSTS = ["/me/published_posts", "/me/feed", "/me/posts"];

// Même logique pour les champs : lire les commentaires d'une publication, c'est lire
// du contenu écrit par des utilisateurs, ce que le jeton n'a pas forcément le droit de
// faire — et un seul champ refusé fait échouer toute la requête. On redescend donc par
// paliers jusqu'à ce que ça passe, et on dit ce qu'on a perdu en route.
const PALIERS_CHAMPS = [
  {
    nom: "complet",
    champs: "id,created_time,message,permalink_url,full_picture,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)",
  },
  {
    nom: "sans les commentaires",
    champs: "id,created_time,message,permalink_url,full_picture,shares,reactions.summary(true).limit(0)",
  },
  {
    nom: "sans les commentaires ni les réactions",
    champs: "id,created_time,message,permalink_url,full_picture,shares",
  },
  {
    nom: "publications seules",
    champs: "id,created_time,message,permalink_url,full_picture",
  },
];

async function lireFacebook(token, limite) {
  // 1. Quelle route accepte ce jeton ? On le demande avec le strict minimum, pour que
  //    seul le droit de lire la liste soit en jeu.
  let route = null;
  let echec = null;
  for (const candidate of ROUTES_POSTS) {
    const res = await graphGet(token, candidate, { limit: 1, fields: "id" });
    if (res.ok) { route = candidate; break; }
    echec = echec || res;
  }
  if (!route) {
    return { erreur: graphError(echec && echec.data, "lecture des publications impossible") };
  }

  // 2. Sur cette route, on demande le maximum de champs, puis on redescend.
  let posts = null;
  let palier = null;
  for (const niveau of PALIERS_CHAMPS) {
    const res = await graphGet(token, route, { limit: limite, fields: niveau.champs });
    if (res.ok) { posts = res; palier = niveau; break; }
    posts = res;
  }

  if (!posts.ok) {
    return { erreur: graphError(posts.data, "lecture des publications impossible") };
  }

  const liste = posts.data.data || [];

  const CANDIDATES_FB = [
    "post_impressions_unique",
    "post_impressions",
    "post_engaged_users",
    "post_clicks",
    "post_reactions_by_type_total",
  ];
  const sonde = liste.length
    ? await metriquesValides(token, liste[0].id, CANDIDATES_FB)
    : { retenues: [], erreur: null };
  let insightsRefuses = sonde.erreur ? sonde.erreur.message : null;

  const publications = await Promise.all(
    liste.map(async (p) => {
      const stat = sonde.retenues.length
        ? await insights(token, p.id, sonde.retenues)
        : { valeurs: null, erreur: null };
      if (stat.erreur && !insightsRefuses) insightsRefuses = stat.erreur.message;
      return {
        id: p.id,
        date: p.created_time,
        lien: p.permalink_url || null,
        image: p.full_picture || null,
        // Le texte sert à reconnaître la publication dans le journal, pas à l'analyser.
        debutTexte: p.message ? p.message.slice(0, 120) : null,
        reactions: p.reactions
          ? p.reactions.summary.total_count
          : (stat.valeurs && stat.valeurs.post_reactions_by_type_total !== undefined
              ? Object.values(stat.valeurs.post_reactions_by_type_total).reduce((a, b) => a + b, 0)
              : null),
        commentaires: p.comments ? p.comments.summary.total_count : null,
        partages: p.shares ? p.shares.count : 0,
        portee: stat.valeurs
          ? stat.valeurs.post_impressions_unique ?? stat.valeurs.post_impressions ?? null
          : null,
        interactions: stat.valeurs ? stat.valeurs.post_engaged_users ?? null : null,
        clics: stat.valeurs ? stat.valeurs.post_clicks ?? null : null,
      };
    })
  );

  const page = await graphGet(token, "/me", { fields: "id,name,fan_count,followers_count" });

  return {
    page: page.ok ? page.data : null,
    publications,
    champsLus: palier.nom,
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

  const liste = medias.data.data || [];

  const CANDIDATES_IG = ["reach", "saved", "shares", "total_interactions", "views"];
  const sonde = liste.length
    ? await metriquesValides(token, liste[0].id, CANDIDATES_IG)
    : { retenues: [], erreur: null };
  let insightsRefuses = sonde.erreur ? sonde.erreur.message : null;

  const publications = await Promise.all(
    liste.map(async (m) => {
      const stat = sonde.retenues.length
        ? await insights(token, m.id, sonde.retenues)
        : { valeurs: null, erreur: null };
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
