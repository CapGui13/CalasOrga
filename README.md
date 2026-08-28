# CalasOrga — V15.4 complète

Calendrier partagé du club, prêt pour les tests réels multi-téléphones sur Vercel.

## Interface membre

Une ligne par date et cinq colonnes d'inscription : **Accueil / TPE / MEP / Arbitrage / Présent**.
Chaque membre voit les personnes déjà inscrites et ne peut modifier que ses propres cases.
Les jours ouverts par défaut sont **lundi, mardi et jeudi**.

Membres initiaux : **Odile, Guillaume, Sylvie, Caroline, Véronique, Gérard, Patrick, Christian, Armelle, Pascal**.

## V15.4 — réactivité

- affichage optimiste : le nom apparaît immédiatement au clic ;
- si le serveur refuse l'écriture, l'interface revient automatiquement à l'état confirmé et affiche l'erreur ;
- rafraîchissement membre toutes les **5 secondes** uniquement lorsque la page est visible et qu'aucune écriture locale n'est en cours ;
- ouverture de l'HTML sans lecture Blob inutile ;
- lecture Blob principale en **GET unique** avec récupération de l'ETag, sans HEAD systématique ;
- GET conditionnel (`ifNoneMatch`) lors des rafraîchissements ;
- une mutation normale n'effectue plus une seconde relecture avant le PUT : l'ETag `ifMatch` protège toujours la concurrence et force une relecture/retry en cas de conflit ;
- les snapshots de récupération `.bak` et `.good` restent conservés ;
- `/` ou `/calendar` sans lien personnel affichent désormais une explication au lieu d'une page blanche ;
- `/admin-login` sans clé affiche une explication au lieu d'une page blanche.

## Sécurité et robustesse conservées

- stockage partagé **Vercel Blob privé** ;
- liens personnels révocables ;
- sessions membre et administrateur ;
- permissions contrôlées côté serveur ;
- cookies SameSite/HttpOnly/Secure ;
- protections CSRF, origine, CSP et Sec-Fetch-Site ;
- ETag + retry pour empêcher les écrasements lors de modifications simultanées ;
- historique ;
- sauvegarde complète, validation et restauration ;
- récupération depuis `.good` / `.bak` si le stockage principal est illisible ;
- fermetures exceptionnelles avec confirmation liée à l'état exact des inscriptions ;
- export CSV et correction administrateur ;
- horizon membre limité à 366 jours.

## Déploiement Vercel

Le projet Vercel doit disposer de :

- `ADMIN_TOKEN` (secret administrateur long) ;
- un **Blob privé connecté** au projet, qui crée `BLOB_STORE_ID` et `BLOB_READ_WRITE_TOKEN` ;
- `BLOB_STATE_PATH=calasorga/store.json` si l'on souhaite conserver ce chemin explicite.

Contrôle de santé :

```text
https://TON-PROJET.vercel.app/healthz
```

Résultat attendu :

```json
{"ok":true,"appVersion":"0.15.4-complete-vercel","storage":"vercel-blob","integrity":true}
```

Lien administrateur :

```text
https://TON-PROJET.vercel.app/admin-login#TON_SECRET_ADMIN
```

Les liens membres sont générés depuis l'administration et ont la forme :

```text
https://TON-PROJET.vercel.app/join#SECRET_PERSONNEL
```

## GitHub Pages / fichier HTML local

`index.html` reste autonome pour tester l'interface en mode local. Dans ce mode les données restent dans le navigateur et ne sont pas synchronisées avec Vercel.

## Node / Docker

Le mode serveur Node classique reste disponible. Variables usuelles : `ADMIN_TOKEN`, `DATA_FILE`, `PORT` et éventuellement `TRUST_PROXY=1` derrière un proxy HTTPS.
