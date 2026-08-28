# Calendrier du club — V14 complète

Version cumulative destinée aux premiers tests réels.

## Interface membre

Une ligne par date, avec les colonnes :

**Date | Accueil | TPE | MEP | Arbitrage | Présent**

Un membre clique dans une case pour ajouter son propre nom, puis reclique pour le retirer.
Il voit les noms déjà inscrits mais le serveur lui interdit de modifier ceux des autres.

Jours ouverts par défaut : **lundi / mardi / jeudi**.

Membres initiaux : **Odile, Guillaume, Sylvie, Caroline, Véronique, Gérard, Patrick, Christian, Armelle, Pascal**.

## Fonctions conservées

- synchronisation multi-appareils quand `server.mjs` est réellement hébergé ;
- liens personnels sécurisés ;
- sessions serveur ;
- permissions contrôlées côté serveur ;
- révocation / régénération des liens ;
- administration ;
- correction manuelle d'une inscription et de son rôle ;
- fermeture / ouverture exceptionnelle d'une date ou d'une période ;
- confirmation sûre avant suppression d'inscriptions ;
- historique ;
- export planning CSV ;
- sauvegarde complète + validation + restauration ;
- récupération du stockage `.good` / `.bak` ;
- écritures sérialisées pour éviter les pertes lors d'actions simultanées ;
- CSRF, contrôle d'origine, CSP, cookies SameSite, rate-limit ;
- horizon membre limité à 366 jours ;
- stockage persistant par fichier sur serveur mono-instance.

## 1 — Mettre le code sur GitHub

Mets **tous les fichiers de ce dossier** à la racine d'un dépôt GitHub.

### GitHub Pages

Si tu actives simplement **GitHub Pages**, `index.html` fonctionne automatiquement en **mode test local** : l'interface est testable mais les données restent dans le navigateur de chaque appareil.

Donc :

- GitHub Pages = bon pour tester l'interface ;
- GitHub Pages seul = **pas de synchronisation entre deux téléphones**.

## 2 — Pour tester réellement plusieurs téléphones

Il faut exécuter `server.mjs` sur un hébergement Node avec **stockage persistant**.
Le dépôt GitHub peut être la source du déploiement (Render, Railway avec volume, VPS/Docker, etc.).

Variables minimales :

```text
ADMIN_TOKEN=<un secret administrateur long et aléatoire>
DATA_FILE=/chemin/persistant/store.json
PORT=3000
TRUST_PROXY=1   # si l'hébergeur place l'app derrière son proxy HTTPS
```

Ne mets **jamais** `ADMIN_TOKEN` dans GitHub.

Lancement local serveur :

```bash
ADMIN_TOKEN="un-secret-administrateur-d-au-moins-24-caracteres" npm start
```

Puis ouvre :

```text
http://localhost:3000/admin-login#TON_SECRET_ADMIN
```

Dans l'administration, clique sur **Nouveau lien** pour chaque membre. Le lien généré est celui à lui envoyer.

## 3 — Docker

Le projet contient aussi :

- `Dockerfile`
- `docker-compose.yml`

Le volume Docker `club_data` conserve le fichier de données.

## Données importantes

Le fichier vivant est `data/store.json` par défaut. Il ne doit **pas** être versionné dans GitHub.

Le serveur maintient également des copies de reprise `.good` et `.bak`.

## Important pour Vercel / serverless

Cette version utilise volontairement un fichier persistant sérialisé pour un petit club.
Un hébergement serverless sans disque persistant n'est donc pas adapté tel quel.
Pour ce type d'hébergement, il faudra brancher une base partagée au lieu du fichier.
