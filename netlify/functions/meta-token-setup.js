const { withCors } = require("./_cors.js");
const { requireSecret } = require("./_auth.js");
const { savePageToken } = require("./_metaToken.js");

// Transforme un jeton utilisateur temporaire en jeton de Page PERMANENT, et le range
// dans Firestore. À lancer une seule fois (et à relancer seulement si Meta révoque tout).
//
// Pourquoi ce détour : Meta ne délivre pas de jeton de Page permanent directement.
// Il faut un jeton utilisateur longue durée (60 jours) ; le jeton de Page qu'on en tire
// ensuite, lui, n'expire pas. C'est la seule façon de ne plus se réveiller un matin avec
// un Messenger muet.
//
// Le jeton utilisateur temporaire est déposé par Steve dans les variables d'environnement
// Netlify (META_USER_TOKEN) — jamais dans une conversation, jamais dans le dépôt.
// Une fois l'opération réussie, cette variable peut être supprimée.
//
// POST { action: "run" }        exécute l'échange et enregistre le jeton
// POST { action: "status" }     dit seulement si un jeton permanent est en place

const GRAPH = "https://graph.facebook.com/v21.0";
const APP_ID = process.env.META_APP_ID || "2141660433450329";

function json(statusCode, body) {
  return { statusCode, body: JSON.stringify(body) };
}

function graphError(data, fallback) {
  const err = data && data.error;
  if (!err) return { message: fallback };
  return { message: err.message || fallback, code: err.code, type: err.type };
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

  const { getPageToken } = require("./_metaToken.js");

  if (payload.action === "status") {
    const token = await getPageToken();
    return json(200, { configured: Boolean(token) });
  }

  // Le jeton utilisateur peut venir de deux endroits, jamais d'une conversation :
  // soit une variable d'environnement Netlify, soit — et c'est le chemin privilégié —
  // directement de la page Meta, postée par le navigateur de Steve. Dans ce second cas
  // il transite du champ de l'explorateur vers ce serveur sans jamais être affiché.
  const userToken = (typeof payload.userToken === "string" && payload.userToken.trim())
    || process.env.META_USER_TOKEN;
  const appSecret = process.env.META_APP_SECRET || process.env.MESSENGER_APP_SECRET;

  if (!userToken) {
    return json(400, {
      error: "META_USER_TOKEN absent",
      hint: "Fournir userToken dans la requête, ou définir META_USER_TOKEN chez Netlify.",
    });
  }
  if (!appSecret) {
    return json(500, { error: "Secret de l'application Meta manquant côté serveur" });
  }

  // 1. Jeton utilisateur court → jeton utilisateur longue durée (60 jours).
  const exchangeUrl = new URL(`${GRAPH}/oauth/access_token`);
  exchangeUrl.searchParams.set("grant_type", "fb_exchange_token");
  exchangeUrl.searchParams.set("client_id", APP_ID);
  exchangeUrl.searchParams.set("client_secret", appSecret);
  exchangeUrl.searchParams.set("fb_exchange_token", userToken);

  const exchangeRes = await fetch(exchangeUrl);
  const exchange = await exchangeRes.json().catch(() => ({}));
  if (!exchangeRes.ok || !exchange.access_token) {
    return json(502, {
      error: "Échange du jeton refusé",
      detail: graphError(exchange, "jeton utilisateur invalide ou expiré"),
    });
  }

  // 2. Les Pages administrées par cet utilisateur. Le jeton de Page obtenu à partir
  //    d'un jeton utilisateur longue durée n'expire pas.
  const pagesUrl = new URL(`${GRAPH}/me/accounts`);
  pagesUrl.searchParams.set("fields", "id,name,access_token");
  pagesUrl.searchParams.set("access_token", exchange.access_token);

  const pagesRes = await fetch(pagesUrl);
  const pages = await pagesRes.json().catch(() => ({}));
  if (!pagesRes.ok || !Array.isArray(pages.data)) {
    return json(502, { error: "Liste des Pages illisible", detail: graphError(pages, "échec") });
  }
  if (pages.data.length === 0) {
    return json(400, {
      error: "Aucune Page accessible",
      hint: "Le jeton a-t-il bien été généré avec l'autorisation pages_show_list, et la Page cochée ?",
    });
  }

  // On vise ECOSOLARNET ; s'il n'y a qu'une Page, c'est elle.
  const wanted = payload.pageId || payload.pageName;
  const page =
    (wanted &&
      pages.data.find(
        (p) => p.id === wanted || (p.name || "").toLowerCase() === String(wanted).toLowerCase()
      )) ||
    pages.data.find((p) => (p.name || "").toLowerCase().includes("ecosolarnet")) ||
    (pages.data.length === 1 ? pages.data[0] : null);

  if (!page) {
    return json(400, {
      error: "Page introuvable",
      pages: pages.data.map((p) => ({ id: p.id, name: p.name })),
    });
  }
  if (!page.access_token) {
    return json(502, { error: "Pas de jeton pour cette Page — autorisations insuffisantes" });
  }

  // 3. Vérifie que ce jeton n'expire vraiment pas avant de s'en contenter.
  const debugUrl = new URL(`${GRAPH}/debug_token`);
  debugUrl.searchParams.set("input_token", page.access_token);
  debugUrl.searchParams.set("access_token", `${APP_ID}|${appSecret}`);
  const debugRes = await fetch(debugUrl);
  const debug = await debugRes.json().catch(() => ({}));
  const info = debug && debug.data ? debug.data : {};
  const neverExpires = info.expires_at === 0 || info.expires_at === undefined;

  await savePageToken({
    pageId: page.id,
    pageName: page.name,
    pageAccessToken: page.access_token,
  });

  return json(200, {
    ok: true,
    page: { id: page.id, name: page.name },
    neverExpires,
    expiresAt: info.expires_at || null,
    scopes: info.scopes || [],
    note: neverExpires
      ? "Jeton permanent enregistré. La variable META_USER_TOKEN peut être supprimée."
      : "Jeton enregistré mais avec une date d'expiration — vérifier les autorisations.",
  });
}));
