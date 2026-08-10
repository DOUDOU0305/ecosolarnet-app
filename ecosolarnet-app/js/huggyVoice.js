import { getSettings } from "./db.js";

let voicesPromise = null;

function pollForVoices(resolve) {
  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) {
    resolve(existing);
    return;
  }
  // Sur iPhone, la liste des voix (surtout les voix "Améliorées"/"Premium"
  // fraîchement téléchargées) peut mettre plusieurs secondes à être disponible
  // pour la page. On réessaie régulièrement au lieu d'abandonner après 1 essai.
  let attempts = 0;
  const maxAttempts = 20; // ~10 secondes
  const interval = setInterval(() => {
    attempts++;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0 || attempts >= maxAttempts) {
      clearInterval(interval);
      resolve(voices);
    }
  }, 500);
}

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
    pollForVoices(resolve);
  });
  return voicesPromise;
}

// Force un nouveau chargement (bouton "Rafraîchir" côté réglages), utile si les
// voix n'étaient pas encore prêtes au premier chargement de la page.
export function forceReloadVoices() {
  voicesPromise = null;
  return loadVoices();
}

export async function getFrenchVoices() {
  const voices = await loadVoices();
  return voices.filter((v) => (v.lang || "").toLowerCase().startsWith("fr"));
}

// Le Web Speech API ne fournit pas le genre d'une voix : on le déduit du prénom
// dans son nom, à partir des voix françaises connues sur iPhone/Mac, Windows et
// Chrome/Android. Si une voix n'est reconnue dans aucune des deux listes, elle
// n'apparaît dans ni l'une ni l'autre (mieux vaut la signaler pour l'ajouter que
// de risquer de la classer dans le mauvais genre).
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
// selon la plateforme ("Thomas Premium", "Thomas (Amélioré)", "Amélioré - Thomas"...).
export function classifyVoiceGender(voiceName) {
  const words = stripAccents(String(voiceName || "").toLowerCase()).split(/[^a-z]+/).filter(Boolean);
  if (words.some((w) => MALE_NAMES.includes(w))) return "homme";
  if (words.some((w) => FEMALE_NAMES.includes(w))) return "femme";
  return null;
}

export async function getFrenchVoicesByGender() {
  const voices = await getFrenchVoices();
  return {
    homme: voices.filter((v) => classifyVoiceGender(v.name) === "homme"),
    femme: voices.filter((v) => classifyVoiceGender(v.name) === "femme"),
    inconnu: voices.filter((v) => classifyVoiceGender(v.name) === null),
  };
}

// Copie en mémoire des réglages de voix, tenue à jour par refreshVoiceSettingsCache().
// speak() doit rester 100% synchrone jusqu'à l'appel à speechSynthesis.speak() :
// Safari sur iOS bloque silencieusement la voix si le moindre "await" s'intercale
// entre le geste de l'utilisateur (le clic) et cet appel.
let voiceSettingsCache = {
  huggyVoiceGender: "homme",
  huggyVoiceNameHomme: "",
  huggyVoiceNameFemme: "",
  huggyVoiceRate: 0.92,
  huggyVoicePitch: 1,
};

export async function refreshVoiceSettingsCache() {
  const settings = await getSettings();
  voiceSettingsCache = {
    huggyVoiceGender: settings.huggyVoiceGender,
    huggyVoiceNameHomme: settings.huggyVoiceNameHomme,
    huggyVoiceNameFemme: settings.huggyVoiceNameFemme,
    huggyVoiceRate: settings.huggyVoiceRate,
    huggyVoicePitch: settings.huggyVoicePitch,
  };
  // S'assure aussi que la liste des voix est chargée avant le premier appel à speak().
  await loadVoices();
}

export function speak(text, overrides = {}) {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();

  const voices = window.speechSynthesis.getVoices();
  const gender = overrides.gender || voiceSettingsCache.huggyVoiceGender || "homme";
  const wantedName = overrides.voiceName ?? (gender === "femme" ? voiceSettingsCache.huggyVoiceNameFemme : voiceSettingsCache.huggyVoiceNameHomme);
  const voice = voices.find((v) => v.name === wantedName);

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
