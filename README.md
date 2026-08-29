# CalasOrga — V15.7

Calendrier partagé du club. Production : **Vercel + Vercel Blob privé**. GitHub Pages sert de porte d’entrée stable pour les membres et l’administration.

## Accès membre

Les liens personnels courts ont la forme :

```text
https://capgui13.github.io/CalasOrga/#Prenom123456
```

Lors de la première ouverture, le lien est vérifié côté serveur et une session longue durée est créée sur l’appareil. Ensuite, l’ouverture de `https://capgui13.github.io/CalasOrga/` renvoie automatiquement vers le calendrier de ce membre. Si la session a été révoquée ou a expiré, le marqueur local est supprimé et l’application demande d’ouvrir à nouveau le lien personnel.

Les anciens liens longs V15.6 restent acceptés pendant la transition.

## Administration

Porte d’entrée stable :

```text
https://capgui13.github.io/CalasOrga/Admin/
```

Le code administrateur de 6 caractères est vérifié côté serveur. Le long `ADMIN_TOKEN` reste utilisable comme secret de secours.

L’administration affiche le nombre d’appareils actuellement connectés pour chaque membre et permet de **déconnecter tous ses appareils** sans révoquer son lien personnel.

## Synchronisation et performance

- affichage optimiste lors d’une inscription ;
- rafraîchissement membre adaptatif : **2 s** après activité récente, puis **5 s**, puis **10 s** après une longue période sans interaction ;
- rafraîchissement immédiat au retour sur la page ;
- le polling est suspendu lorsque la page n’est pas visible ;
- les connexions membre/admin évitent désormais la double lecture Blob et n’écrivent pas les snapshots `.bak/.good` pour une simple création de session ;
- les mutations métier conservent ETag + retry et les snapshots de récupération.

## Sécurité

- stockage partagé Vercel Blob privé ;
- permissions contrôlées côté serveur ;
- cookies `HttpOnly`, `Secure`, `SameSite=Strict` en HTTPS ;
- protections CSRF, origine, CSP et `Sec-Fetch-Site` ;
- liens personnels révocables ;
- maximum de 5 sessions membre actives par personne ;
- changement d’identité sur un appareil déjà associé soumis à confirmation ;
- codes courts membres protégés par HMAC ;
- `MEMBER_SHORT_SECRET` indépendant des identifiants administrateur ;
- compatibilité avec le pepper V15.6 pour les liens courts déjà distribués ;
- récupération `.good` / `.bak` avec révocation de toutes les sessions et de tous les liens actifs ;
- sauvegarde, validation, restauration et protection contre les écritures concurrentes.

## Variables Vercel

Variables requises/recommandées :

```text
ADMIN_TOKEN=<secret long de secours>
ADMIN_CODE=<code administrateur de 6 caractères>
MEMBER_SHORT_SECRET=<secret aléatoire indépendant, au moins 32 caractères>
BLOB_STATE_PATH=calasorga/store.json
```

Vercel ajoute les variables du Blob privé (`BLOB_STORE_ID`, `BLOB_READ_WRITE_TOKEN`).

**Important :** `MEMBER_SHORT_SECRET` doit rester stable. Une fois configuré, ne le changez pas. Les liens V15.6 historiques restent compatibles grâce au pepper de transition.

## Santé

```text
https://calasorga.vercel.app/healthz
```

Réponse attendue en V15.7 :

```json
{"ok":true,"appVersion":"0.15.7.0-device-security-performance-vercel","storage":"vercel-blob","integrity":true,"memberShortSecretMode":"dedicated"}
```

## Tests

```bash
npm run check
npm test
```

Le test V15.7 démarre un serveur local isolé et vérifie notamment : connexion admin, création de liens courts, association d’un appareil, confirmation de changement d’identité, comptage des appareils et révocation des sessions membre.
