const { listDocs, setDoc } = require("./_firestoreAdmin.js");
const { FIREBASE_PROJECT_ID, WORKSPACE_ID } = require("./_metaToken.js");

// Publie, à l'heure dite, les publications déposées dans la file d'attente par
// programmer-publication.js.
//
// Pourquoi cette fonction existe : Facebook sait programmer une publication de
// lui-même (scheduled_publish_time), Instagram non — son API ne connaît que
// "publie maintenant". On a d'abord contourné ça par une tâche planifiée sur le
// Mac de Steve ; le 20/09/2026 elle s'est bloquée en attente d'une autorisation
// que personne n'était là pour donner, et la publication du dimanche est passée
// à la trappe. Le rôle de ce fichier est de faire la même chose sans dépendre
// d'un ordinateur allumé : Netlify l'appelle toutes les deux minutes (voir la
// section [functions] de netlify.toml), il regarde ce qui est dû, il publie.
//
// Le travail est découpé en deux temps volontairement, parce qu'un conteneur
// Instagram n'est pas prêt tout de suite et qu'une fonction Netlify ne vit que
// quelques dizaines de secondes : un passage crée le conteneur, le suivant le
// publie s'il n'a pas eu le temps de finir. Une publication arrive donc au pire
// quelques minutes après son heure — sans commune mesure avec le fait de la
// rater.

const COLLECTION = `artisans/${WORKSPACE_ID}/publicationsProgrammees`;

// Marge de sécurité : on garde de quoi écrire l'état dans Firestore avant que
// Netlify ne coupe la fonction. Ce qui n'est pas fini repasse au tour suivant.
const BUDGET_MS = 18000;
const ESSAIS_MAX = 3;

function url(chemin) {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || "";
  return `${base}/.netlify/functions/${chemin}`;
}

// On appelle la fonction voisine plutôt que de refaire les appels Graph ici :
// publish-instagram est déjà éprouvée, autant qu'il n'existe qu'un seul endroit
// où la publication Instagram est écrite.
async function instagram(corps) {
  const res = await fetch(url("publish-instagram"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-app-secret": process.env.APP_SHARED_SECRET || "",
    },
    body: JSON.stringify(corps),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function enregistrer(entree, champs) {
  await setDoc(FIREBASE_PROJECT_ID, `${COLLECTION}/${entree.id}`, {
    ...entree,
    ...champs,
    traiteLe: Date.now(),
  });
}

async function echec(entree, message) {
  const essais = (entree.essais || 0) + 1;
  await enregistrer(entree, {
    essais,
    erreur: message,
    // Trois échecs suffisent à distinguer un incident passager d'un contenu
    // que Meta refusera toujours. Au-delà on arrête : mieux vaut une
    // publication manquée qu'une fonction qui s'acharne toutes les deux minutes.
    etat: essais >= ESSAIS_MAX ? "echec" : "attente",
  });
}

async function traiter(entree, finAvant) {
  let creationId = entree.creationId;

  if (!creationId) {
    const photoUrls = Array.isArray(entree.photoUrls) ? entree.photoUrls.filter(Boolean) : [];
    const corps = { action: "creer", message: entree.message || "" };
    if (entree.videoUrl) corps.videoUrl = entree.videoUrl;
    else if (photoUrls.length > 1) corps.photoUrls = photoUrls;
    else if (photoUrls.length === 1) corps.photoUrl = photoUrls[0];
    else return echec(entree, "Ni photo ni vidéo à publier");

    const res = await instagram(corps);
    if (!res.ok || !res.data.creationId) {
      return echec(entree, res.data.error || "Création du conteneur refusée");
    }
    creationId = res.data.creationId;
    // Écrit tout de suite : si la fonction est coupée juste après, le passage
    // suivant reprend ce conteneur au lieu d'en créer un second — ce qui
    // publierait deux fois.
    await enregistrer(entree, { creationId, etat: "conteneur" });
    entree = { ...entree, creationId, etat: "conteneur" };
  }

  let pret = false;
  while (!pret && Date.now() < finAvant) {
    const res = await instagram({ action: "etat", creationId });
    const statut = res.data && res.data.statut;
    if (statut === "FINISHED") pret = true;
    else if (statut === "ERROR" || statut === "EXPIRED") {
      return echec(entree, `Instagram a rejeté le média (${statut})`);
    } else await new Promise((r) => setTimeout(r, 3000));
  }

  // Pas prêt dans le temps imparti : on ne touche à rien, le passage suivant
  // retrouvera le conteneur et reprendra là où on s'arrête.
  if (!pret) return;

  const res = await instagram({ action: "publier", creationId });
  if (!res.ok || !res.data.ok) {
    return echec(entree, res.data.error || "Publication refusée");
  }
  await enregistrer(entree, { etat: "publie", lien: res.data.url || "", erreur: "" });
}

exports.handler = async function handler() {
  const finAvant = Date.now() + BUDGET_MS;

  let file;
  try {
    file = await listDocs(FIREBASE_PROJECT_ID, COLLECTION);
  } catch (err) {
    return { statusCode: 500, body: String(err) };
  }

  const maintenant = Date.now();
  const dues = file
    .filter((e) => e && e.id && e.quand <= maintenant)
    .filter((e) => e.etat === "attente" || e.etat === "conteneur")
    .sort((a, b) => a.quand - b.quand);

  if (!dues.length) return { statusCode: 200, body: "rien à publier" };

  // Une seule par passage : deux carrousels d'affilée ne tiendraient pas dans
  // le temps d'une fonction, et le passage suivant est dans deux minutes.
  try {
    await traiter(dues[0], finAvant);
  } catch (err) {
    try {
      await echec(dues[0], String(err));
    } catch {
      /* si Firestore est injoignable, le passage suivant réessaiera */
    }
  }

  return { statusCode: 200, body: `traité : ${dues[0].id}` };
};
