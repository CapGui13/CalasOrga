# CalasOrga — V15.45

Calendrier partagé du club, qualifié pour un usage **desktop, tablette et mobile**. Production : **Vercel + Vercel Blob privé**. GitHub Pages reste la porte d’entrée stable des membres et de l’administration.

## Accès membre

Les liens personnels courts conservent la forme `https://capgui13.github.io/CalasOrga/#Prenom123456`. À la première ouverture, le lien est vérifié côté serveur puis une session longue durée est associée à l’appareil.

## Administration

Porte d’entrée stable : `https://capgui13.github.io/CalasOrga/Admin/`. L’administration gère membres, appareils, planning, rôles, historique, exports et sauvegardes.

## Multi-device V15.45

- desktop : double-clic conservé sur les deux interactions historiques ; Entrée/Espace fonctionnent au clavier ;
- tactile : un seul tap produit la même action ;
- hybrides Surface/DeX : distinction par `PointerEvent.pointerType` afin qu’une souris reste en double-clic et qu’un doigt/stylet reste en simple tap ;
- planning en cartes jusqu’à 980 px ; tables membres/historique en cartes téléphone ;
- cibles tactiles critiques >= 44 px ;
- safe areas iOS/iPadOS prises en compte ;
- modales scrollables et focus clavier contenu ;
- éditeur de journée : aide tactile visible « membre puis poste ».

## Architecture frontend V15.45

> Le bundle navigateur s’appelle `client.js` (et non `app.js`) afin d’éviter l’auto-détection serveur Vercel des fichiers racine nommés `app.*`. Le preset Vercel est verrouillé sur `Other` via `"framework": null`.


Le frontend n’est plus monolithique :

- `index.html` contient uniquement la structure HTML ;
- `styles.css` contient les styles desktop/tablette/mobile ;
- `client.js` contient la logique navigateur ;
- la CSP n’utilise plus de hashes de blocs inline : `script-src 'self'` et `style-src 'self'` suffisent ;
- les routes admin imbriquées servent explicitement `client.js` et `styles.css`, y compris en serveur Node local.

Le nettoyage ne change pas le modèle de données ni les règles métier. Les protections et comportements V15.44 restent qualifiés.

## Sécurité et confidentialité

- aucun nom ni email réel n’est embarqué dans le frontend public ni dans le roster source du serveur ;
- le roster réel reste dans le stockage privé ;
- la migration V15.44 du roster est **non destructive** : membres, liens, sessions, disponibilités et rôles existants sont conservés ;
- désactiver un membre demande une confirmation explicite et précise que les inscriptions futures seront retirées ;
- stockage Vercel Blob privé, permissions serveur, CSRF/origine/CSP, cookies `HttpOnly`/`Secure`/`SameSite=Strict` ;
- liens personnels révocables et sauvegardes contrôlées.

## Synchronisation

Le rafraîchissement reste adaptatif (rapide après activité, plus lent ensuite), immédiat au retour sur la page et suspendu lorsque la page n’est pas visible. Les mutations métier conservent ETag + retry et snapshots de récupération.

## Variables Vercel

```text
ADMIN_TOKEN=<secret long de secours>
ADMIN_CODE=<code administrateur de 6 caractères>
MEMBER_SHORT_SECRET=<secret aléatoire indépendant, au moins 32 caractères>
BLOB_STATE_PATH=calasorga/store.json
```

Vercel fournit les variables du Blob privé. `MEMBER_SHORT_SECRET` doit rester stable.

## Santé

`https://calasorga.vercel.app/healthz`

Réponse attendue :

```json
{"ok":true,"appVersion":"0.15.45.0-cleanup-multidevice-vercel","storage":"vercel-blob","integrity":true,"memberShortSecretMode":"dedicated"}
```

## Tests

```bash
npm run check
npm test
```

Le test V15.45 vérifie les parcours serveur historiques ainsi que les invariants de hardening multi-device (confidentialité du source, confirmation de désactivation, clavier/tactile, cibles 44 px, aide tactile, safe areas et versioning).
