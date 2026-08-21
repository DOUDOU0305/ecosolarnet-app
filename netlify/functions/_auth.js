// Vérifie l'en-tête "X-App-Secret" envoyé par l'app (voir js/config.js)
// contre la variable d'environnement Netlify APP_SHARED_SECRET. Tant que
// cette variable n'est pas configurée côté Netlify, on laisse tout passer
// (pour ne pas casser l'app avant que Steve ait fait l'étape manuelle) —
// mais dans ce cas la protection est inactive, pas une vraie sécurité.
function checkSecret(event) {
  const expected = process.env.APP_SHARED_SECRET;
  if (!expected) return true;
  const provided = event.headers["x-app-secret"] || event.headers["X-App-Secret"];
  return provided === expected;
}

// Toujours utilisé À L'INTÉRIEUR de withCors (voir _cors.js), qui intercepte
// déjà les requêtes OPTIONS de préflight avant qu'elles n'atteignent ici —
// donc pas besoin de re-vérifier la méthode.
function requireSecret(handler) {
  return async function wrapped(event, context) {
    if (!checkSecret(event)) {
      return { statusCode: 401, body: "Non autorisé" };
    }
    return handler(event, context);
  };
}

module.exports = { checkSecret, requireSecret };
