# Développer sur cider-ia

Ce document s'adresse à qui modifie le code : organisation du dépôt, fonctionnement général, commandes, tests et déploiement. Pour l'utilisation, voir [interface.md](interface.md) et les autres pages de `docs/`.

## Le dépôt

```
cider-ia/
├── cider-app/        application Angular (servie par nginx)
├── cider-server/     serveur Node.js (Fastify) : comptes, projets, images, IA
├── docker/           Dockerfiles, nginx, en-têtes de sécurité, backup.sh, README de déploiement
├── docs/             documentation utilisateur et développeur (ce dossier)
├── docker-compose.yml          déploiement à partir des images publiées
└── docker-compose.build.yml    surcharge pour construire les images sur place
```

## Fonctionnement général

```
 navigateur                                   serveur
┌───────────────────────────────┐            ┌──────────────────────────┐
│ Angular                       │  /api/...  │ cider-server (Fastify)   │
│  pages ─▶ services ─▶ Dexie   │ ─────────▶ │  users.json, sessions    │
│           (IndexedDB =        │ ◀───────── │  projects/<user>/…       │
│            copie de travail)  │            │  blobs/ (images, SHA-256)│
└───────────────────────────────┘            │  IA : OpenAI/Gemini/     │
                                             │       ComfyUI            │
                                             └──────────────────────────┘
```

- L'application garde le code d'origine de Cider : toutes les données d'un projet sont dans une base **IndexedDB** du navigateur (Dexie, `data-services/indexed-db/db.ts`), lue et écrite par des services par table (`DecksService`, `CardsService`, `CardTemplatesService`, `AssetsService`…).
- Le fork ajoute le serveur : à l'ouverture, le projet est chargé dans cette base (copie de travail) ; chaque modification déclenche un enregistrement automatique (`server/current-project.service.ts`) qui envoie le projet, avec les images remplacées par leur empreinte. Seules les images que le serveur n'a pas encore sont envoyées (`/api/blobs/missing`, puis `PUT /api/blobs/:hash`).
- Un seul projet est ouvert par navigateur : les onglets se coordonnent (`server/tab-coordinator.service.ts`).
- `AppDB.onChange()` émet chaque création, modification ou suppression (table, type, clé) ; le panneau latéral et l'enregistrement automatique s'y abonnent. **Une modification (`update`) ne reconstruit pas l'arbre du panneau** : après un déplacement d'image, par exemple, il faut appeler `updateFiles()`.
- Le deck en cours est porté par `DecksService.selectedDeck`, renseigné par `DeckGuard` sur les routes `decks/:deckId/...` ; les services de cartes, attributs et modèles filtrent sur ce deck.

## Application (`cider-app/src/app`)

| Dossier | Contenu |
| :--- | :--- |
| `site-template`, `site-menu`, `site-activitybar`, `site-sidebar`, `site-content`, `site-footer` | Cadre de l'écran : barre du haut, barre d'activité, panneau latéral (Explorateur avec sélecteur de deck, Illustrations en vignettes ou en liste), zone de page, barre du bas. |
| `deck-tabs` | Onglets en haut des pages d'un deck. |
| `project`, `decks`, `cards`, `card-thumbnails`, `card-attributes`, `card-templates`, `template-generator`, `documents`, `document`, `assets`, `asset`, `asset-generator` | Pages (une par route, voir `app.routes.ts`). |
| `card-binder` | Classeur de cartes, effets foil (`_foil.scss`), directive d'inclinaison (`card-tilt.directive.ts`). |
| `card-preview` | Rendu d'une carte (Handlebars + HTML/CSS nettoyé par DOMPurify). |
| `boosters` | Simulateur de boosters : pool, poids, design recto/verso du sachet (`booster-pack.component`), ouverture animée, statistiques ; logique pure dans `booster-logic.ts` et `booster-template.ts`. |
| `game-simulator` | Simulateur de partie. |
| `export-cards` | Exports PDF, images, Tabletop Simulator et **set pour l'appli de collection** (`collector-set.ts`). |
| `cards-transfer` | Import / export CSV et JSON (format `cartes-fangh`), synchronisation à trois états. |
| `ai` | Prompt d'illustration du deck, fenêtre d'illustration d'une carte, appel du serveur pour la génération. |
| `server` | Connexion, comptes, page Projets, versions, import de projets, administration (utilisateurs, paramètres IA), enregistrement automatique. |
| `data-services` | Base Dexie, services par table, types, rendu en image (`image-renderer.service.ts`). |
| `shared` | Helpers Handlebars, extensions de l'éditeur Monaco, générateurs, garde `DeckGuard`, utilitaires. |
| `cards-tab-menu` | Ancien menu à onglets du projet d'origine, plus utilisé. |

### Traductions

Tous les textes passent par ngx-translate : `src/assets/i18n/fr.json` et `en.json`. **Ajouter chaque clé dans les deux fichiers.** Les clés sont groupées par écran (`sidebar.*`, `boosters.*`, `export.*`, `activity.*`…).

## Serveur (`cider-server/src`)

| Fichier | Rôle |
| :--- | :--- |
| `index.ts` | Démarrage du serveur. |
| `app.ts` | Routes de l'API. |
| `config.ts` | Variables d'environnement (voir [docker/README.md](../docker/README.md#variables)). |
| `passwords.ts` | Hachage scrypt des mots de passe. |
| `store/` | Stockage en fichiers JSON écrits d'un bloc : utilisateurs, sessions, projets et versions, images (`blobs.ts`, `project-blobs.ts`), réglages et consommation IA. |
| `ai/` | Prompt d'illustration et services d'images (`providers/openai.ts`, `gemini.ts`, `comfyui.ts`). |
| `tools/check-data.ts` | Vérification des données sans modification (avant une mise à jour, après une restauration). |

### API

Toutes les routes sont sous `/api`, demandent la session (cookie) sauf `health`, `auth/status`, `auth/setup` et `auth/login`, et un en-tête anti-CSRF pour les écritures.

| Route | Rôle |
| :--- | :--- |
| `GET health` | Le serveur répond. |
| `GET auth/status`, `POST auth/setup` | Une installation neuve a-t-elle un administrateur ; création du premier (avec le code de configuration). |
| `POST auth/login`, `POST auth/logout`, `GET auth/me`, `POST auth/password` | Session et mot de passe. |
| `GET/POST users`, `PATCH/DELETE users/:id` | Comptes (administrateurs), dont accès à l'IA et quota. |
| `GET/POST projects`, `GET/PATCH/DELETE projects/:id` | Projets de l'utilisateur. |
| `GET/PUT projects/:id/data` | Contenu du projet (images remplacées par des références). |
| `GET projects/:id/export` | Export `database.json` complet, images incluses. |
| `POST blobs/missing`, `PUT/GET blobs/:hash` | Images manquantes, envoi, lecture. |
| `GET projects/:id/versions`, `GET …/versions/:revision`, `POST …/versions/:revision/restore` | Versions conservées. |
| `GET ai/status`, `GET/PATCH/DELETE ai/settings`, `POST ai/images` | Disponibilité et réglages de l'IA, génération d'images. |

## Commandes

```bash
# application
cd cider-app
npm ci
npm start                  # serveur de développement sur :4200, relaie /api vers :3000
npm run lint               # obligatoire : la CI échoue sur la moindre erreur
npm run test:ci            # tests Karma (Chrome headless)
npm run build              # build de production

# serveur
cd cider-server
npm ci
CIDER_DATA_DIR=./data npm run dev   # rechargement automatique
npm test                             # tests node:test
npm run typecheck
```

Sans Chrome installé, indiquer un Chromium à Karma : `CHROME_BIN=/chemin/vers/chrome npm run test:ci`.

Tester l'application construite avec le vrai serveur, sans HTTPS :

```bash
cd cider-server && npm run build
CIDER_DATA_DIR=/tmp/ciderdata CIDER_SETUP_TOKEN=setup123 CIDER_COOKIE_SECURE=false node dist/index.js
```

## Intégration continue et déploiement

`.github/workflows/ci.yaml`, à chaque push sur `main` et à chaque pull request :

1. **app** : `npm ci`, lint, tests, build ;
2. **server** : `npm ci`, tests, build ;
3. si les deux passent sur `main` : construction et publication des images `ghcr.io/morgulas/cider-ia-web` et `ghcr.io/morgulas/cider-ia-api` (étiquettes `latest` et `sha-<commit>`).

Le déploiement télécharge ces images ([docker/README.md](../docker/README.md)) : **une erreur de lint ou un test en échec bloque la mise en production**. Lancer `npm run lint` et les tests avant de pousser.

## Dépendances : versions bloquées

- **PrimeNG reste en 21.x** : à partir de la 22, PrimeNG n'est plus sous licence MIT mais sous licence PrimeUI (clé de licence exigée, redistribution restreinte), peu compatible avec un fork AGPL dont les images Docker sont publiques. Or **Angular 22 exige PrimeNG 22** : l'application reste donc en **Angular 21**, maintenu jusqu'en mai 2027. D'ici là, envisager une autre bibliothèque de composants ou un fork communautaire resté sous MIT.
- **Thème** : `@primeuix/themes` en 2.x (MIT, même moteur `@primeuix/styled` 0.7 que PrimeNG 21). La 3.x est sous licence PrimeUI.
- **Dexie reste en 3.x** (et `dexie-export-import` en 4.1.x, la 4.4 exigeant Dexie 4) : passer à Dexie 4 touche aux données gardées dans le navigateur, à faire avec précaution.
- **monaco-editor** est fixé par `ngx-monaco-editor-v2` (`overrides` du `package.json`).

## Pièges connus (rendu 3D des sachets et cartes)

Les effets d'inclinaison et de foil (classeur, sachets de booster) ont buté sur des comportements de Chrome :

- un `filter` sur un élément en `preserve-3d` aplatit la 3D et ignore `backface-visibility` : pour un recto/verso qui pivote, basculer la `visibility` des faces à mi-rotation ;
- un dégradé répété dont la `background-position` sort de 0–100 % montre une couture : le reflet (glare) est borné à 0–100 % (`card-tilt.directive.ts`, `_foil.scss`) ;
- les dents des sachets sont faites par `clip-path` (fonction SCSS `crimped-polygon`), sur la même couche que le foil, pour qu'elles s'inclinent avec lui.

## Conventions

- Textes de l'interface en français et en anglais ; documentation en français.
- Les nouveautés visibles se documentent dans `docs/` et se signalent dans le tableau « Ce que le fork ajoute » du [README](../README.md).
- Les commits vont directement sur `main` (dépôt personnel) ; la CI fait office de filet.
