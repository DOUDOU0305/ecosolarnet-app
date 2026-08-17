import { getSettings } from "./db.js";

export function isNative() {
  return typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();
}

function nativePlugin() {
  // Set by js/vendor/native-plugins.bundle.js (esbuild bundle of
  // @capacitor-community/text-to-speech, loaded via a classic <script> tag in
  // index.html since this app has no build step of its own). @capacitor/core's
  // registerPlugin() reads and extends the existing window.Capacitor object
  // rather than replacing it, so bundling it here is safe even though the
  // native iOS shell also injects a (minimal) window.Capacitor itself.
  return window.NativeTTS || null;
}

let voicesPromise = null;
// Full, unfiltered list from the native plugin — speak() needs an index into
// THIS exact array (not into any filtered subset), per the plugin's API.
let nativeVoicesFull = [];

export function loadVoices() {
  if (voicesPromise) return voicesPromise;

  if (isNative()) {
    const plugin = nativePlugin();
    voicesPromise = plugin
      ? plugin
          .getSupportedVoices()
          .then((res) => {
            nativeVoicesFull = res.voices || [];
            return nativeVoicesFull.filter((v) => (v.lang || "").toLowerCase().startsWith("fr"));
          })
          .catch(() => [])
      : Promise.resolve([]);
    return voicesPromise;
  }

  if (!("speechSynthesis" in window)) return Promise.resolve([]);
  voicesPromise = new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    window.speechSynthesis.onvoiceschanged = () => {
      resolve(window.speechSynthesis.getVoices());
    };
    // Filet de sécurité : certains navigateurs ne déclenchent jamais l'événement.
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1500);
  });
  return voicesPromise;
}

// Ni le Web Speech API ni le plugin natif ne fournissent le genre d'une voix :
// on le déduit du prénom dans son nom. Sur iPhone, Safari ne donne accès qu'à
// un très petit nombre de voix système (souvent une seule par genre, ex.
// Thomas / Amélie) — les voix "Premium"/"Améliorées" téléchargées dans
// Réglages iPhone ne sont accessibles qu'aux apps natives (Siri, VoiceOver...,
// et maintenant la nôtre via ce plugin), jamais aux sites web.
const MALE_NAMES = [
  "thomas", "daniel", "jacques", "nicolas", "bruno", "julien", "antoine", "xavier",
  "paul", "henri", "louis", "marc", "pierre", "david", "denys", "fabrice",
  "guillaume", "mathieu", "maxime", "olivier", "philippe", "yannick", "alain",
  "vincent",
];
const FEMALE_NAMES = [
  "amelie", "aude", "audrey", "aurelie", "chantal", "celine", "marie", "virginie", "lea",
  "julie", "hortense", "charlotte", "elise", "manon", "camille", "claire",
  "emilie", "fanny", "isabelle", "juliette", "leonie", "margaux", "sophie",
  "sandrine", "florence", "helene", "nathalie", "sylvie", "valerie",
];

function stripAccents(str) {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// On découpe sur tout ce qui n'est pas une lettre (espace, parenthèse, tiret,
// point...) et on regarde si l'UN des mots obtenus est un prénom connu, plutôt
// que de se fier uniquement au premier mot : les noms de voix varient beaucoup
// selon la plateforme ("Thomas Premium", "Thomas (Amélioré)"...).
export function classifyVoiceGender(voiceName) {
  const words = stripAccents(String(voiceName || "").toLowerCase()).split(/[^a-z]+/).filter(Boolean);
  if (words.some((w) => MALE_NAMES.includes(w))) return "homme";
  if (words.some((w) => FEMALE_NAMES.includes(w))) return "femme";
  return null;
}

// Parmi les voix natives d'un même genre, privilégie une voix "Enhanced" /
// "Améliorée" / "Premium" si l'utilisateur en a téléchargé une dans Réglages
// iPhone — c'est exactement ce qui les rend moins robotiques que les voix
// standard.
function isEnhancedVoiceName(name) {
  const n = stripAccents(String(name || "").toLowerCase());
  return n.includes("enhanced") || n.includes("ameliore") || n.includes("premium");
}

function pickBestVoice(voices, gender) {
  const matches = voices.filter((v) => classifyVoiceGender(v.name) === gender);
  const pool = matches.length > 0 ? matches : voices;
  if (pool.length === 0) return null;
  return pool.find((v) => isEnhancedVoiceName(v.name)) || pool[0];
}

// Copie en mémoire des réglages de voix, tenue à jour par refreshVoiceSettingsCache().
// Sur le web, speak() doit rester 100% synchrone jusqu'à l'appel à
// speechSynthesis.speak() : Safari sur iOS bloque silencieusement la voix si
// le moindre "await" s'intercale entre le geste de l'utilisateur (le clic) et
// cet appel. Le plugin natif n'a pas cette contrainte (pas de restriction de
// "geste utilisateur" côté AVSpeechSynthesizer), donc son appel peut rester
// asynchrone en arrière-plan sans que l'appelant ait besoin d'attendre.
let voiceSettingsCache = {
  huggyVoiceGender: "homme",
  huggyVoiceRate: 0.92,
  huggyVoicePitch: 1,
};

export async function refreshVoiceSettingsCache() {
  const settings = await getSettings();
  voiceSettingsCache = {
    huggyVoiceGender: settings.huggyVoiceGender,
    huggyVoiceRate: settings.huggyVoiceRate,
    huggyVoicePitch: settings.huggyVoicePitch,
  };
  // S'assure aussi que la liste des voix est chargée avant le premier appel à speak().
  await loadVoices();
}

function resolveParams(overrides) {
  return {
    gender: overrides.gender || voiceSettingsCache.huggyVoiceGender || "homme",
    rate: overrides.rate ?? voiceSettingsCache.huggyVoiceRate ?? 0.92,
    pitch: overrides.pitch ?? voiceSettingsCache.huggyVoicePitch ?? 1,
  };
}

export function speak(text, overrides = {}) {
  if (!text) return;
  const { gender, rate, pitch } = resolveParams(overrides);

  if (isNative()) {
    const plugin = nativePlugin();
    if (!plugin) return;
    const frVoices = nativeVoicesFull.filter((v) => (v.lang || "").toLowerCase().startsWith("fr"));
    const chosen = pickBestVoice(frVoices, gender);
    const index = chosen ? nativeVoicesFull.indexOf(chosen) : undefined;
    plugin.stop().catch(() => {});
    plugin
      .speak({
        text,
        lang: "fr-FR",
        rate,
        pitch,
        volume: 1.0,
        category: "playback",
        ...(index != null && index >= 0 ? { voice: index } : {}),
      })
      .catch(() => {});
    return;
  }

  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();

  const voices = window.speechSynthesis.getVoices().filter((v) => (v.lang || "").toLowerCase().startsWith("fr"));
  const voice = pickBestVoice(voices, gender);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  utterance.rate = rate;
  utterance.pitch = pitch;
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

// Same as speak(), but resolves once the utterance has finished playing —
// used by the hands-free voice loop to know when it's safe to start
// listening again. Not used by any of the plain fire-and-forget call sites
// (Huggy tips, assistant text replies typed manually, the Réglages test
// button), so it's kept separate rather than changing speak()'s signature.
export function speakAndWait(text, overrides = {}) {
  if (!text) return Promise.resolve();
  const { gender, rate, pitch } = resolveParams(overrides);

  if (isNative()) {
    const plugin = nativePlugin();
    if (!plugin) return Promise.resolve();
    const frVoices = nativeVoicesFull.filter((v) => (v.lang || "").toLowerCase().startsWith("fr"));
    const chosen = pickBestVoice(frVoices, gender);
    const index = chosen ? nativeVoicesFull.indexOf(chosen) : undefined;
    return plugin
      .stop()
      .catch(() => {})
      .then(() =>
        plugin.speak({
          text,
          lang: "fr-FR",
          rate,
          pitch,
          volume: 1.0,
          category: "playback",
          ...(index != null && index >= 0 ? { voice: index } : {}),
        })
      )
      .catch(() => {});
  }

  if (!("speechSynthesis" in window)) return Promise.resolve();
  window.speechSynthesis.cancel();

  const voices = window.speechSynthesis.getVoices().filter((v) => (v.lang || "").toLowerCase().startsWith("fr"));
  const voice = pickBestVoice(voices, gender);

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = rate;
    utterance.pitch = pitch;
    if (voice) utterance.voice = voice;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking() {
  if (isNative()) {
    nativePlugin()?.stop().catch(() => {});
    return;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
