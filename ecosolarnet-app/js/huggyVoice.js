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

export async function speak(text, overrides = {}) {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();

  const settings = overrides.settings || (await getSettings());
  const voices = await loadVoices();
  const gender = overrides.gender || settings.huggyVoiceGender || "homme";
  const wantedName = overrides.voiceName ?? (gender === "femme" ? settings.huggyVoiceNameFemme : settings.huggyVoiceNameHomme);
  const voice = voices.find((v) => v.name === wantedName);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fr-FR";
  utterance.rate = overrides.rate ?? settings.huggyVoiceRate ?? 0.92;
  utterance.pitch = overrides.pitch ?? settings.huggyVoicePitch ?? 1;
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
