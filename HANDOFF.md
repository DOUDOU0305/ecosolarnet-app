# ECOSOLARNET — Document de continuité

Ce document explique comment l'application ECOSOLARNET fonctionne "sous le capot" : quels comptes sont utilisés, comment ils sont reliés entre eux, et comment publier une mise à jour. Il est écrit pour deux publics :

- **Steve** (le propriétaire de l'entreprise) — pour comprendre à quoi sert chaque compte, même sans connaissances techniques.
- **Un futur développeur** qui reprendrait ce projet si l'assistant IA actuel (Claude) n'était plus disponible.

**Important** : ce document explique le fonctionnement et où trouver chaque chose. Il ne contient volontairement **aucun mot de passe ni clé secrète en clair** (sauf une, expliquée au point 4, qui est de toute façon déjà visible dans le code de l'application). Les mots de passe des comptes ci-dessous sont à conserver par Steve lui-même, dans un endroit sûr (gestionnaire de mots de passe, ou carnet gardé en lieu sûr).

---

## 1. Vue d'ensemble

ECOSOLARNET existe sous deux formes, construites à partir du **même code source** :

- **Application web (PWA)** : accessible depuis n'importe quel navigateur à l'adresse **https://frabjous-treacle-60d239.netlify.app**
- **Application native iOS** : installée sur l'iPhone de Steve via TestFlight, construite à partir du même code mais empaquetée avec **Capacitor** pour accéder à des fonctions que le web seul ne permet pas (position GPS en continu, notifications, partage de fichiers, etc.)

Le code source vit à deux endroits sur l'ordinateur de développement :
- `/Users/ecosolarnet/CLAUDE/ecosolarnet-app/` — le code de la PWA (la source de vérité)
- `/Users/ecosolarnet/CLAUDE/ecosolarnet-ios/` — le projet Xcode/Capacitor qui enveloppe une copie de ce même code pour en faire l'app iOS

Le code est aussi déposé sur **GitHub** (voir point 2) — c'est la copie "officielle" que Netlify utilise pour publier le site.

## 2. Comptes utilisés et à quoi ils servent

| Compte | À quoi il sert | Où le gérer |
|---|---|---|
| **GitHub** (compte `DOUDOU0305`) | Héberge le code source. Chaque dépôt de fichiers ("commit") déclenche une republication automatique sur Netlify. | github.com/DOUDOU0305/ecosolarnet-app |
| **Netlify** | Héberge le site web, et fait tourner les "fonctions serveur" (le code qui parle à l'IA, à Twilio, à Firebase). C'est aussi là que vivent les clés secrètes (voir point 4). | app.netlify.com |
| **Firebase** (projet `ecosolarnet-54647`, société Google) | Base de données en ligne (Firestore) : stocke tous les clients, devis, rendez-vous, etc., et les synchronise en temps réel entre les appareils. | console.firebase.google.com |
| **Twilio** | Envoie et reçoit les messages WhatsApp automatiquement (les demandes de devis, réponses auto, etc.). | console.twilio.com |
| **Anthropic** | Fournit l'intelligence artificielle (Claude) qui lit les emails/WhatsApp, rédige des brouillons de réponse, comprend les commandes vocales, etc. | console.anthropic.com |
| **Apple Developer Program** (Team ID `MQ2T83TM42`) | Permet de publier l'app native sur TestFlight/App Store. Abonnement payant annuel (99 $/an), au nom de Steve. | developer.apple.com |

## 3. Comment tout est connecté (architecture, en langage simple)

```
[ Téléphone de Steve ]
       │
       ├── App native iOS (TestFlight)  ─┐
       │                                  │  même code JavaScript
[ Navigateur web ] ── App PWA ───────────┘
       │
       │  1. Les données (clients, devis, RDV...) sont d'abord
       │     enregistrées sur l'appareil lui-même (hors-ligne possible),
       │     puis synchronisées en temps réel avec :
       ▼
[ Firebase Firestore ]  ← base de données partagée entre tous les appareils
       ▲
       │  2. Pour tout ce qui demande de l'intelligence artificielle,
       │     d'envoyer un WhatsApp, ou de lire une sauvegarde, l'app
       │     appelle une "fonction serveur" hébergée sur Netlify :
       ▼
[ Fonctions Netlify ]  (dossier netlify/functions/ dans le code)
       │
       ├──→ [ Anthropic (Claude) ]   — IA : classification, rédaction, assistant vocal
       ├──→ [ Twilio ]               — envoi/réception WhatsApp
       └──→ [ Firebase Firestore ]   — lecture/écriture directe (sauvegardes, logs d'erreurs)
```

Chaque fonction Netlify est protégée par une clé secrète (voir point 4) pour empêcher que n'importe qui sur internet ne les utilise à la place de Steve.

## 4. Où sont les clés secrètes

Toutes les clés secrètes sont stockées dans **Netlify → le site ecosolarnet → Site configuration → Environment variables** (jamais écrites en clair dans le code déposé sur GitHub, sauf une exception ci-dessous) :

- `ANTHROPIC_API_KEY` — clé pour appeler l'IA Claude
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER` — accès à Twilio/WhatsApp
- `FIREBASE_SERVICE_ACCOUNT_JSON` — clé de service pour que les fonctions serveur puissent lire/écrire dans Firestore avec des droits d'administrateur
- `APP_SHARED_SECRET` — mot de passe partagé entre l'app et ses propres fonctions serveur, pour empêcher un tiers de les appeler directement (voir plus bas)

**Exception** : `APP_SHARED_SECRET` est la seule clé qui apparaît aussi en clair dans le code de l'app lui-même (fichier `js/config.js`), parce que l'app, en tournant dans le navigateur de Steve, doit pouvoir la présenter à chaque appel. Ce n'est donc pas un secret parfaitement inviolable (n'importe qui pourrait le lire en inspectant le code de l'app), mais ça bloque déjà tout abus "au hasard" (bots, scan d'adresses), qui est le risque réel pour une petite app comme celle-ci — une vraie sécurité complète demanderait un système de comptes utilisateurs, disproportionné ici.

La configuration publique de Firebase (`js/firebaseConfig.js`) n'est **pas** un secret — c'est normal et attendu qu'elle soit visible dans le code, la vraie protection vient des règles de sécurité configurées côté Firebase (accès réservé aux utilisateurs authentifiés, même anonymement).

## 5. Comment publier une mise à jour

### Version web (PWA)
1. Modifier le code dans `ecosolarnet-app/`
2. Copier le dossier entier sur `~/Desktop/ecosolarnet-app`
3. Glisser-déposer ce dossier sur github.com/DOUDOU0305/ecosolarnet-app/upload/main et cliquer "Commit changes"
4. Netlify republie automatiquement le site en 1-2 minutes

Toujours augmenter `CACHE_NAME` en haut de `service-worker.js` à chaque changement de fichier JS/CSS — sinon les téléphones continuent de servir une version en cache, périmée.

### Version native iOS
1. Copier `ecosolarnet-app/` vers `ecosolarnet-ios/www/` (rsync)
2. Depuis `ecosolarnet-ios/`, lancer `npx cap sync ios` (copie `www/` dans le projet Xcode)
3. Augmenter `CURRENT_PROJECT_VERSION` dans `ecosolarnet-ios/ios/App/App.xcodeproj/project.pbxproj` (deux occurrences)
4. Depuis `ecosolarnet-ios/ios/App/`, lancer :
   ```
   xcodebuild archive -project App.xcodeproj -scheme App -archivePath /tmp/AppN.xcarchive -allowProvisioningUpdates -destination "generic/platform=iOS"
   xcodebuild -exportArchive -archivePath /tmp/AppN.xcarchive -exportOptionsPlist /tmp/exportOptions.plist -allowProvisioningUpdates
   ```
   (`exportOptions.plist` : `method=app-store-connect`, `teamID=MQ2T83TM42`, `destination=upload`, `signingStyle=automatic`)
5. Le nouveau build apparaît dans TestFlight (App Store Connect) après 10-30 minutes de traitement par Apple. Steve l'installe depuis l'app TestFlight sur son téléphone.

**Il n'y a pas de dépôt Git local ni de pipeline automatisé** : chaque étape ci-dessus est faite à la main. C'est un choix délibéré vu le profil de Steve (aucune compétence technique), pas un oubli.

## 6. Sauvegardes et surveillance des erreurs

Deux systèmes tournent en arrière-plan, invisibles pour Steve :

- **Sauvegardes automatiques** : une fois par jour, l'app envoie une copie complète des données (clients, devis, tournées...) vers Firestore (`artisans/ecosolarnet/backups/{date}`), conservée 60 jours. Pour consulter :
  `GET https://frabjous-treacle-60d239.netlify.app/.netlify/functions/get-backups` (liste les dates disponibles)
  `GET .../get-backups?date=AAAA-MM-JJ` (contenu complet d'une sauvegarde)
  — les deux nécessitent l'en-tête `X-App-Secret` avec la valeur trouvée dans `js/config.js`.

- **Journal d'erreurs** : l'app capture discrètement toute erreur rencontrée (plantage, appel réseau échoué...) et la stocke dans Firestore (`artisans/ecosolarnet/errorLogs`). Pour consulter :
  `GET https://frabjous-treacle-60d239.netlify.app/.netlify/functions/get-error-logs` (même en-tête requis)

**Restaurer une sauvegarde** n'a pas d'interface dédiée (volontairement, pour ne rien complexifier côté Steve) — en cas de besoin réel, il faut récupérer le JSON via `get-backups`, puis réutiliser la logique déjà présente dans `js/backup.js` (`importBackupFromFile`) pour la réappliquer sur l'appareil concerné (l'IndexedDB est propre à chaque appareil, donc ça se fait en direct avec Steve).

## 7. Limites connues (choix assumés, pas des oublis)

- Pas de tests automatisés, pas d'environnement de test séparé — chaque changement part directement dans l'app réelle de Steve.
- Pas de correction automatique des bugs par une IA sans supervision — Steve a explicitement choisi qu'un humain (via une conversation avec l'IA) reste dans la boucle plutôt qu'un robot 24h/24 qui modifierait le code seul.
- Les bibliothèques externes utilisées (génération de PDF, QR codes) sont figées à une version précise, sans suivi automatique des mises à jour de sécurité.
- Pas de module de facturation complet (évoqué mais jamais construit), pas de vrai numéro WhatsApp Business (utilise le numéro Sandbox Twilio).

## 8. Si un jour il faut reprendre ce projet sans l'IA actuelle

Un futur développeur aura besoin de :
1. L'accès aux comptes listés au point 2 (Steve doit transmettre les identifiants séparément et de façon sécurisée — jamais par ce document).
2. Ce fichier (`HANDOFF.md`) et le code source lui-même, qui contient beaucoup de commentaires expliquant le "pourquoi" des choix faits.
3. Comprendre que ce projet privilégie délibérément la simplicité (pas de build step, pas de framework, pas de dépendances npm côté fonctions serveur) pour rester maintenable par quelqu'un qui reprendrait le projet sans configuration compliquée à reproduire.
