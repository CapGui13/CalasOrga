# Calendrier du club — V15.2 complète

Version cumulative destinée aux tests réels, y compris **plusieurs téléphones synchronisés sur Vercel**.

## Correctif V15.2

Un Blob privé nouvellement créé est vide. V15.2 traite explicitement ce premier démarrage comme un état normal : le serveur crée automatiquement `calasorga/store.json` avec le roster initial et l'enveloppe de stockage complète. Les différentes signatures `BlobNotFound` de `@vercel/blob` sont prises en charge aussi bien sur `head()` que sur `get()`.

## Interface membre

Une ligne par date, avec les colonnes :

**Date | Accueil | TPE | MEP | Arbitrage | Présent**

Un membre clique dans une case pour ajouter son propre nom, puis reclique pour le retirer.
Il voit les noms déjà inscrits mais le serveur lui interdit de modifier ceux des autres.

Jours ouverts par défaut : **lundi / mardi / jeudi**.

Membres initiaux : **Odile, Guillaume, Sylvie, Caroline, Véronique, Gérard, Patrick, Christian, Armelle, Pascal**.

## Fonctions conservées

- synchronisation multi-appareils ;
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
- récupération depuis une copie valide si le stockage principal devient illisible ;
- protection contre les pertes lors de modifications simultanées ;
- CSRF, contrôle d'origine, CSP, cookies SameSite/HttpOnly/Secure ;
- horizon membre limité à 366 jours.

## GitHub Pages

`index.html` reste utilisable sur GitHub Pages pour tester l'interface.
Dans ce cas, les données restent volontairement dans le navigateur : **GitHub Pages seul ne synchronise pas les appareils**.

## Déploiement Vercel — recommandé pour les tests partagés

V15.2 utilise **Vercel Blob privé** comme stockage partagé. Les écritures utilisent un ETag et une nouvelle tentative automatique pour empêcher deux téléphones de s'écraser mutuellement.

### 1. Importer le dépôt dans Vercel

Importer le dépôt GitHub `CapGui13/CalasOrga` comme projet Vercel.

Ajouter une variable d'environnement :

```text
ADMIN_TOKEN=<secret-administrateur-long-et-aleatoire>
```

Ne jamais mettre ce secret dans GitHub.

### 2. Ajouter le stockage

Dans le projet Vercel : **Storage → Create → Blob**.

Créer un Blob avec **accès privé** et le connecter au projet `CalasOrga`.
Vercel fournit alors automatiquement les identifiants nécessaires (`BLOB_READ_WRITE_TOKEN` ou `BLOB_STORE_ID` + OIDC selon la configuration Vercel).

Aucune clé Blob ne doit être copiée dans GitHub.

### 3. Redéployer

Après connexion du Blob, relancer le déploiement Production.

Le contrôle :

```text
/healthz
```

doit répondre avec :

```json
{"ok":true,"storage":"vercel-blob","integrity":true}
```

### 4. Ouvrir l'administration

Avec le secret configuré dans `ADMIN_TOKEN` :

```text
https://TON-PROJET.vercel.app/admin-login#TON_SECRET_ADMIN
```

Dans l'administration, générer un lien personnel pour chaque membre et lui envoyer uniquement son propre lien.

## Stockage et concurrence

Sur Vercel, l'état partagé est conservé dans un Blob privé. Avant chaque modification, le serveur lit la dernière version et son ETag. L'écriture n'est acceptée que si cette version n'a pas changé. En cas d'action simultanée, l'opération est recalculée sur la nouvelle version puis réessayée.

Le mode Node/Docker classique reste disponible avec un fichier persistant sérialisé (`DATA_FILE`).

## Docker / serveur Node classique

Variables minimales :

```text
ADMIN_TOKEN=<secret long>
DATA_FILE=/chemin/persistant/store.json
PORT=3000
TRUST_PROXY=1
```

Le `docker-compose.yml` conserve le fichier dans le volume `club_data`.

## Correctifs V15.2

- premier démarrage d’un Blob privé vide : création automatique de `calasorga/store.json` ;
- compatibilité avec le preset Vercel **Node** : `server.mjs` exporte désormais son `http.Server` par défaut, comme attendu par le runtime Vercel ;
- le mode Node/Docker et le wrapper `api/index.mjs` restent compatibles.
