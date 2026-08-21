// Netlify hosts the serverless functions (AI, Gmail classify, photo analysis).
// In the native app the WebView isn't same-origin with Netlify, so calls must be absolute.
// On the web PWA (served from Netlify itself) a relative path also works fine.
const NETLIFY_ORIGIN = "https://frabjous-treacle-60d239.netlify.app";
const isNative = typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();

export const FUNCTIONS_BASE = isNative ? `${NETLIFY_ORIGIN}/.netlify/functions` : "/.netlify/functions";
// Static assets (e.g. audio/*.mp3) must always be an absolute URL: Shotstack's
// render service fetches them from the public internet, so a relative path
// (which only makes sense inside the app's own WebView) would never resolve.
export const SITE_ORIGIN = NETLIFY_ORIGIN;

// Envoyé en en-tête "X-App-Secret" sur chaque appel aux fonctions serveur qui
// coûtent de l'argent (Anthropic, Twilio) ou renvoient des données sensibles,
// pour empêcher n'importe qui de les appeler directement en devinant leur
// adresse. Ce n'est PAS un vrai secret côté client (il est visible dans ce
// fichier JS livré au navigateur) — mais ça bloque déjà tout abus "occasionnel"
// (bots, scan d'URLs), qui est le risque réel pour une petite app comme
// celle-ci. Doit correspondre exactement à la variable d'environnement
// Netlify APP_SHARED_SECRET (voir netlify/functions/_auth.js).
export const APP_SHARED_SECRET = "68a7a0fe9c37bbf10dfa319a1046dc9aca7a0f5466ba459377194bc1feac635e";
