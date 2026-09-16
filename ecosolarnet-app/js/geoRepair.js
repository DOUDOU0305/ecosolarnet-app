// Répare les coordonnées des clients : celles qui manquent, et celles qui sont fausses.
//
// Le problème constaté le 2026-09-16 : un client de la rue des Écoles à Acoz était
// enregistré avec des coordonnées situées près de Liège, à 95 km. Le géocodeur ne se
// trompe plus sur cette adresse aujourd'hui, mais les coordonnées d'août étaient restées
// telles quelles — rien ne les remet en question une fois écrites. Conséquences : le client
// sort des tournées de sa propre commune, et un devis lui facturerait 76 € de déplacement.
//
// Principe : le code postal est la donnée la plus sûre d'une fiche, parce que Steve le tape
// lui-même et le relit. On s'en sert d'arbitre. Pour chaque commune on cherche une fois son
// centre, puis on compare chaque client à ce centre.
//
// Nominatim est gratuit et tolère environ une requête par seconde ; la file d'attente de
// geo.js impose déjà ce rythme. On ne repasse donc pas tous les jours : une fois par semaine
// suffit largement pour un fichier client qui bouge de quelques fiches par mois.

import { Store } from "./db.js";
import { geocodeAddress, haversineKm, fullAddress } from "./geo.js";

// Au-delà de cette distance entre un client et le centre de sa commune, les coordonnées
// sont considérées comme fausses. 20 km laisse de la marge aux grandes communes et aux
// centres approximatifs, tout en attrapant les erreurs franches (la nôtre était à 95 km).
const ECART_MAX_KM = 20;
const DELAI_ENTRE_PASSAGES_MS = 7 * 24 * 60 * 60 * 1000;

function centreCommuneQuery(client) {
  return `${client.postalCode} ${client.city || ""}, Belgique`;
}

export async function repairClientCoordinates({ force = false } = {}) {
  // On lit l'enregistrement brut, pas getSettings() : celui-ci complète avec les valeurs
  // par défaut, et les réécrire ici écraserait les vrais réglages sur un appareil qui
  // n'a pas encore reçu la synchro (voir le commentaire de getSettings dans db.js).
  let settings;
  try {
    settings = await Store.get("settings", "main");
  } catch {
    return null;
  }

  const dernier = settings?.lastGeoRepairAt || 0;
  if (!force && Date.now() - dernier < DELAI_ENTRE_PASSAGES_MS) return null;

  let clients;
  try {
    clients = await Store.getAll("clients");
  } catch {
    return null;
  }

  const centres = new Map();
  const bilan = { manquantes: 0, corrigees: 0, irrecuperables: 0 };

  for (const client of clients) {
    if (!client.postalCode || !client.address) continue;

    // Le centre de la commune sert d'arbitre ; on ne le cherche qu'une fois par code postal.
    const cle = String(client.postalCode);
    if (!centres.has(cle)) {
      try {
        centres.set(cle, await geocodeAddress(centreCommuneQuery(client)));
      } catch {
        centres.set(cle, null);
      }
    }
    const centre = centres.get(cle);
    if (!centre) continue;

    const aDesCoords = client.lat != null && client.lng != null;
    const ecart = aDesCoords
      ? haversineKm({ lat: client.lat, lng: client.lng }, centre)
      : null;

    if (aDesCoords && ecart != null && ecart <= ECART_MAX_KM) continue;

    // Soit la fiche n'a jamais été localisée, soit elle l'a été au mauvais endroit.
    let coords = null;
    try {
      coords = await geocodeAddress(fullAddress(client));
    } catch {
      coords = null;
    }

    const bonnes = coords && haversineKm(coords, centre) <= ECART_MAX_KM;
    // Quand l'adresse reste introuvable, le centre de la commune vaut toujours mieux qu'un
    // point à 95 km : la fiche revient au moins dans la bonne tournée.
    const retenues = bonnes ? coords : centre;

    try {
      await Store.put("clients", { ...client, lat: retenues.lat, lng: retenues.lng });
      if (!aDesCoords) bilan.manquantes += 1;
      else bilan.corrigees += 1;
      if (!bonnes) bilan.irrecuperables += 1;
    } catch {
      /* une fiche qui refuse de s'enregistrer ne doit pas arrêter les autres */
    }
  }

  // Tant qu'aucun réglage n'existe localement, on ne crée pas l'enregistrement : on
  // repassera au prochain démarrage, une fois la synchro arrivée.
  if (settings) {
    try {
      await Store.put("settings", { ...settings, lastGeoRepairAt: Date.now() });
    } catch {
      /* sans importance : au pire on repassera au prochain démarrage */
    }
  }

  return bilan;
}
