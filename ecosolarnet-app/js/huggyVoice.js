import { getSettings } from "./db.js";

let voicesPromise = null;

export function loadVoices() {
  if (!("speechSynthesis" in window)) return Promise.resolve([]);
  if (voicesPromise) return voicesPromise;
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

// Le Web Speech API ne fournit pas le genre d'une voix : on le déduit du prénom
// dans son nom. Sur iPhone, Safari ne donne accès qu'à un très petit nombre de
// voix système (souvent une seule par genre, ex. Thomas / Amélie) — les voix
// "Premium"/"Améliorées" téléchargées dans Réglages iPhone ne sont accessibles
// qu'aux apps natives (Siri, VoiceOver...), jamais aux sites web.
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

// Copie en mémoire des réglages de voix, tenue à jour par refreshVoiceSettingsCache().
// speak() doit rester 100% synchrone jusqu'à l'appel à speechSynthesis.speak() :
// Safari sur iOS bloque silencieusement la voix si le moindre "await" s'intercale
// entre le geste de l'utilisateur (le clic) et cet appel.
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

export function speak(text, overrides = {}) {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();

  const voices = window.speechSynthesis.getVoices().filter((v) => (v.lang || "").toLowerCase().startsWith("fr"));
  const gender = overrides.gender || voiceSettingsCache.huggyVoiceGender || "homme";
  const voice = voices.find((v) => classifyVoiceGender(v.name) === gender) || voices[0];

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  utterance.rate = overrides.rate ?? voiceSettingsCache.huggyVoiceRate ?? 0.92;
  utterance.pitch = overrides.pitch ?? voiceSettingsCache.huggyVoicePitch ?? 1;
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
