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
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000);
  });
  return voicesPromise;
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
  "amelie", "audrey", "aurelie", "chantal", "celine", "marie", "virginie", "lea",
  "julie", "hortense", "charlotte", "elise", "manon", "camille", "claire",
  "emilie", "fanny", "isabelle", "juliette", "leonie", "margaux", "sophie",
  "sandrine", "florence", "helene", "nathalie", "sylvie", "valerie",
];

function stripAccents(str) {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function classifyVoiceGender(voiceName) {
  const firstWord = stripAccents(String(voiceName || "").toLowerCase()).split(/[\s(]/)[0];
  if (MALE_NAMES.includes(firstWord)) return "homme";
  if (FEMALE_NAMES.includes(firstWord)) return "femme";
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
