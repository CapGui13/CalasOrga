# CalasOrga — UX hardening 3 modes

Calendrier partagé du club, qualifié pour un usage **desktop, tablette et mobile**. Production : **Vercel + Supabase Postgres privé**. GitHub Pages reste la porte d’entrée stable des membres et de l’administration.

## Accès membre

Les liens personnels courts conservent la forme `https://capgui13.github.io/CalasOrga/#Prenom123456`. À la première ouverture, le lien est vérifié côté serveur puis une session longue durée est associée à l’appareil.

## Administration

Porte d’entrée stable : `https://capgui13.github.io/CalasOrga/Admin/`. L’administration gère membres, appareils, planning, rôles, exports et sauvegardes. L’historique n’est plus exposé dans l’interface.

## Contrat UI : exactement 3 modes

Le frontend applique une classe unique sur `<html>` et `<body>` :

- `ui-desktop` : référence complète, souris/clavier, grand tableau ;
- `ui-tablet` : desktop compact tactile, jamais de cartes téléphone ;
- `ui-mobile` : interface d’app, navigation au pouce et vues compactes.

L’auto-détection reste stable en portrait/paysage : un appareil tactile dont le petit côté fait moins de 600 px est mobile ; à partir de 600 px il est tablette. Un grand appareil hybride Windows / pointeur fin actif (Surface, PC tactile avec souris ou trackpad) est traité comme desktop.

Pour diagnostiquer les appareils hybrides, un override persistant est disponible :

```text
?ui=desktop
?ui=tablet
?ui=mobile
?ui=auto      # supprime l’override et revient à la détection automatique
```

L’override peut aussi être piloté dans la console avec `CalasOrgaUiMode.set('desktop'|'tablet'|'mobile'|'auto')`.

## Ergonomie UX hardening

### Desktop

- planning et membres restent les vues de référence ;
- dans la grande fenêtre `Modifier`, un membre peut maintenant être **cliqué puis affecté à un poste**, en plus du drag & drop ;
- une aide explicite rappelle les deux gestes ;
- les interactions clavier existantes sont conservées.

### Tablette

- mêmes tableaux que desktop avec proportions compactes ;
- toutes les actions critiques tactiles sont >= 44 px ;
- textes fonctionnels relevés pour une meilleure lecture réelle ;
- indicateurs visuels signalent le contenu horizontal restant ;
- un tap sur un membre ouvre une fiche détaillée pour récupérer les informations éventuellement tronquées ;
- l’éditeur de journée garde ses six colonnes et une barre rapide apparaît après sélection d’un membre.

### Mobile

- navigation admin fixe en bas : `Calendrier / Membres` ;
- planning en tableau compact avec colonne Date fixe et balayage horizontal signalé ;
- gestion des membres : vue d’ensemble compacte `Membre / Statut / Appareils`, puis **fiche membre en bottom sheet** au tap pour email, appareils, lien et actions ;
- fenêtre `Modifier` : six colonnes conservées comme repère, colonne Membres fixe et barre rapide `Accueil / TPE / MEP / Arbitrage / Disponible` après sélection ;
- safe areas iOS/iPadOS et cibles tactiles >= 44 px.

## Modales et accessibilité

Les overlays utilisent désormais un gestionnaire commun pour :

- sauvegarder et restaurer le focus ;
- sortir le focus avant `aria-hidden=true` ;
- conserver `modal-open` tant qu’une modale imbriquée reste ouverte ;
- piéger Tab dans la modale active.

L’ancien éditeur membre legacy non utilisé a été retiré.

## Architecture frontend

> Le bundle navigateur s’appelle `client.js` (et non `app.js`) afin d’éviter l’auto-détection serveur Vercel des fichiers racine nommés `app.*`. Le preset Vercel reste verrouillé sur `Other` via `"framework": null`.

Le frontend reste séparé :

- `index.html` : structure HTML ;
- `styles.css` : styles et contrat des 3 modes ;
- `client.js` : logique navigateur ;
- `api/index.mjs` + `server.mjs` : backend inchangé par ce chantier UX.

## Sécurité et confidentialité

- aucun nom ni email réel n’est embarqué dans le frontend public ni dans le roster source du serveur ;
- le roster réel reste dans le stockage privé ;
- la migration du roster reste non destructive ;
- désactiver un membre demande une confirmation explicite ;
- stockage Supabase privé, CSRF/origine/CSP et cookies sécurisés conservés.

## Variables Vercel

```text
ADMIN_TOKEN=<secret long de secours>
ADMIN_CODE=<code administrateur de 6 caractères>
MEMBER_SHORT_SECRET=<secret aléatoire indépendant, au moins 32 caractères>
BLOB_STATE_PATH=calasorga/store.json
```

## Santé

`https://calasorga.vercel.app/healthz`

Le backend actuellement qualifié répond notamment avec :

```json
{"ok":true,"appVersion":"0.15.47.2-stabilized","storage":"supabase-postgres","integrity":true,"memberShortSecretMode":"dedicated"}
```

## Tests

```bash
npm run check
npm test
```

`npm test` lance :

1. les parcours serveur/hardening historiques ;
2. une **matrice Chromium réelle** sans dépendance npm supplémentaire, qui vérifie desktop 1440×900, tablette 712×1138 et mobile 375×667. Si Chromium n’est pas installé dans l’environnement CI, la partie navigateur est explicitement marquée `SKIP`.


## Nom navigateur
Le titre de l’onglet navigateur est **Planning Bridge**.


## V15.46.2 — Blob quota hardening

- polling visible : 5 min après activité, puis 15 min ;
- synchronisation au retour sur l’onglet si la dernière lecture date de plus de 30 s ;
- une lecture Blob = un seul `get()` (ETag inclus), sans `head()` préalable ;
- cache mémoire Vercel 60 s (`BLOB_REFRESH_TTL_MS`) ;
- refresh concurrents coalescés ;
- optimistic concurrency conservée sur les écritures.

## Protection contre un démarrage Supabase vide

En production, si `CALASORGA_STORAGE=supabase` et que la ligne `calasorga_state/main` n'existe pas encore, le serveur refuse de créer automatiquement un état vierge. Cela protège les membres, liens personnels et affectations historiques contre un remplacement accidentel.

Trois chemins de mise en service existent :

1. Restaurer temporairement l'accès au Blob et lancer `npm run migrate:blob:supabase`.
2. Importer un backup JSON avec `npm run import:supabase -- <backup.json>`.
3. Repartir volontairement à zéro en définissant temporairement `SUPABASE_ALLOW_EMPTY_INIT=1`, ouvrir l'application une fois, puis supprimer/repasser cette variable à `0`.

## Envoi des liens par email

En production, l’envoi utilise Gmail SMTP via `GMAIL_USER` et `GMAIL_APP_PASSWORD` (mot de passe d’application Google). `GMAIL_FROM_NAME` est optionnel. Les secrets restent exclusivement dans les variables Vercel et ne doivent jamais être commités.
