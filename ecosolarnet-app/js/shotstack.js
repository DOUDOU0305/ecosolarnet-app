import { FUNCTIONS_BASE, SITE_ORIGIN, APP_SHARED_SECRET } from "./config.js";

// Montage vidéo dans le cloud (Shotstack). Les trois fonctions serveur existaient déjà
// mais n'étaient appelées nulle part : ce module est le chaînon manquant entre l'écran
// "Réseaux sociaux" et le moteur de rendu.
//
// Le parcours complet, pour chaque montage :
//   1. demander une adresse d'envoi par média          (shotstack-ingest)
//   2. y déposer le fichier, puis attendre qu'il soit prêt  (shotstack-status, type=source)
//   3. lancer le rendu avec la musique choisie          (shotstack-render)
//   4. attendre la fin du rendu                         (shotstack-status, type=render)
//
// Chaque étape est lente (quelques dizaines de secondes au total), d'où le rapport
// d'avancement : sans lui, Steve a l'impression que l'app a planté.

const HEADERS = { "content-type": "application/json", "X-App-Secret": APP_SHARED_SECRET };

// Les quatre musiques retenues par Steve le 2026-09-13, après écoute, parmi une
// sélection Pixabay de huit. Quatre suffisent : au-delà, choisir devient une corvée
// à chaque publication. Licence Pixabay — usage commercial et réseaux sociaux
// autorisés, sans attribution. Les noms affichés décrivent l'ambiance, pas le titre
// d'origine, qui ne dit rien à personne.
export const MUSIQUES = [
  { fichier: "pop-dance.m4a", nom: "Pop dance" },
  { fichier: "dance-enjoue.m4a", nom: "Dance" },
  { fichier: "corporate-positif.m4a", nom: "Positif" },
  { fichier: "vlog-hiphop.m4a", nom: "Vlog hip-hop" },
];

export function urlMusique(fichier) {
  return `${SITE_ORIGIN}/audio/${fichier}`;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function appel(chemin, options) {
  const res = await fetch(`${FUNCTIONS_BASE}/${chemin}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Le serveur n'a pas répondu correctement");
  return data;
}

// Attend qu'un média déposé ou qu'un rendu soit terminé. Shotstack peut échouer
// franchement ("failed") — sans ce cas explicite, l'attente tournerait jusqu'au
// délai maximal et on afficherait "trop long" au lieu de la vraie cause.
async function attendre(type, id, { tentatives = 60, delai = 3000 } = {}) {
  for (let i = 0; i < tentatives; i++) {
    const data = await appel(`shotstack-status?type=${type}&id=${encodeURIComponent(id)}`, {
      headers: { "X-App-Secret": APP_SHARED_SECRET },
    });
    if (data.status === "ready" || data.status === "done") return data.url;
    if (data.status === "failed") throw new Error(data.error || "Le montage a échoué");
    await pause(delai);
  }
  throw new Error("Le montage prend anormalement longtemps — réessayez dans un moment");
}

async function deposer(blob, nomFichier) {
  const { uploadUrl, sourceId } = await appel("shotstack-ingest", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ nom: nomFichier }),
  });

  const envoi = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": blob.type || "application/octet-stream" },
    body: blob,
  });
  if (!envoi.ok) throw new Error("L'envoi de la photo a échoué");

  return attendre("source", sourceId, { tentatives: 40, delai: 2000 });
}

/**
 * Monte une vidéo à partir de photos (et éventuellement d'une vidéo), avec musique.
 * `avancement` est appelé à chaque étape pour tenir Steve au courant.
 * Renvoie l'adresse publique du fichier monté — c'est elle qu'on donne ensuite à
 * Facebook pour publier, sans avoir à héberger la vidéo nous-mêmes.
 */
export async function monter({ photos, musique, format = "publication", avancement = () => {} }) {
  if (!photos || photos.length === 0) throw new Error("Aucune photo à monter");

  const adresses = [];
  for (let i = 0; i < photos.length; i++) {
    avancement(`Envoi de la photo ${i + 1} sur ${photos.length}…`);
    adresses.push(await deposer(photos[i].blob, `photo-${i + 1}.jpg`));
  }

  avancement("Montage en cours…");
  const { renderId } = await appel("shotstack-render", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ images: adresses, musicUrl: urlMusique(musique), format }),
  });

  avancement("Finalisation…");
  const url = await attendre("render", renderId, { tentatives: 80, delai: 3000 });
  if (!url) throw new Error("Le montage s'est terminé sans produire de vidéo");
  return url;
}

/** Publie une vidéo déjà montée sur la Page Facebook, avec sa légende. */
export async function publierSurFacebook({ videoUrl, message }) {
  return appel("publish-facebook", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ action: "publish", videoUrl, message }),
  });
}
