# Déploiement Docker

Cider IA tourne en deux conteneurs :

| Service | Rôle |
| --- | --- |
| `web` | nginx : sert l'application et relaie `/api` vers le service `api` |
| `api` | serveur Node.js : comptes utilisateurs et projets, stockés dans le dossier de données |

Seul `web` est exposé ; `api` n'est joignable que par le réseau interne de Docker.

## Démarrage

```bash
cp .env.example .env    # puis adapter les valeurs
docker compose up -d --build
```

Ouvrir ensuite `http://<hôte>:8080`. Au premier accès, l'application demande de **créer le compte administrateur** : c'est lui qui crée ensuite les autres comptes (menu utilisateur > Utilisateurs).

Cette création demande un **code de configuration**, pour qu'une autre personne du réseau ne puisse pas s'approprier une installation neuve. Le code est affiché dans les logs du conteneur `api` (`docker logs cider-ia-api`, ou l'onglet Logs dans Dockhand) tant qu'aucun compte n'existe ; on peut aussi le fixer avec `CIDER_SETUP_TOKEN`.

Dans Dockhand, les variables de `.env.example` se renseignent dans les variables d'environnement de la stack.

## Variables

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `CIDER_PORT` | `8080` | Port d'accès sur l'hôte |
| `CIDER_DATA_PATH` | `./data` | **Dossier de l'hôte** où sont stockés comptes et projets |
| `PUID` / `PGID` | `1000` | Propriétaire des fichiers de données sur l'hôte (`id -u` / `id -g`) |
| `CIDER_SESSION_DAYS` | `30` | Durée de vie d'une session inutilisée, en jours |
| `CIDER_MAX_PROJECT_MB` | `200` | Taille maximale d'un projet, images comprises, en Mo |
| `CIDER_MAX_PROJECTS_PER_USER` | `100` | Nombre maximal de projets par utilisateur |
| `CIDER_SETUP_TOKEN` | *(vide)* | Code de création du premier administrateur ; vide = code aléatoire affiché dans les logs |
| `CIDER_COOKIE_SECURE` | `auto` | `true` pour toujours marquer le cookie de session `Secure` (recommandé derrière un reverse proxy HTTPS) |

## Dossier de données

```
<CIDER_DATA_PATH>/
├── users.json              comptes (mots de passe hachés avec scrypt)
├── sessions.json           sessions ouvertes (seul le hash du jeton est stocké)
└── projects/
    └── <id utilisateur>/
        ├── index.json      liste des projets de l'utilisateur
        └── <id projet>.json  contenu d'un projet (export de base Cider)
```

- **Sauvegarde** : copier ce dossier suffit (de préférence conteneurs arrêtés, ou au moins en dehors d'un enregistrement).
- Chaque fichier de projet est un export `database.json` standard : il peut être réimporté dans n'importe quelle instance de Cider.
- Le conteneur `api` s'exécute sous l'utilisateur `PUID:PGID` et donne ce dossier à cet utilisateur au démarrage ; les fichiers ne sont lisibles que par lui.

## Fonctionnement des projets

- Chaque utilisateur ne voit que ses propres projets ; l'administrateur gère les comptes mais n'a pas accès aux projets des autres.
- À l'ouverture, le projet est chargé depuis le serveur dans le navigateur, qui en garde une copie de travail. **Chaque modification est enregistrée automatiquement** sur le serveur après une seconde et demie ; l'état est affiché en bas de l'écran.
- Si la page est fermée avant la fin d'un enregistrement, les modifications sont envoyées à la prochaine ouverture du projet dans ce navigateur.
- **Un seul projet ouvert à la fois par navigateur** : tous les onglets partagent la même copie de travail, donc un onglet refuse d'ouvrir un projet tant qu'un autre en a un d'ouvert. Pour travailler sur deux projets en même temps, utiliser deux navigateurs (ou une fenêtre de navigation privée).
- Si le même projet est modifié depuis deux appareils, le second enregistrement est bloqué et l'application demande quelle version garder.
- La copie de travail est marquée avec son propriétaire (utilisateur et projet) : rien n'est jamais envoyé au serveur si elle ne correspond pas au projet en cours.
- À la déconnexion, la copie de travail est effacée du navigateur. Si une session expire et qu'une autre personne se connecte sur le même poste, le projet du premier utilisateur est fermé.

## IA : illustrations de cartes

**Sans clé d'API (gratuit)** : dans **Vignettes**, le bouton ✨ d'une carte ouvre la fenêtre d'illustration, disponible pour tous les comptes. Elle construit le prompt de la carte à partir du **modèle de prompt du deck** (bouton « Modèle de prompt du deck », enregistré avec le projet) : les attributs s'y insèrent comme dans les modèles de cartes (`{{card.name}}`, `{{card.description}}`, `{{#if card.lore}}…{{/if}}`). On copie le prompt dans un chatbot (ChatGPT, Gemini…), puis on colle (Ctrl+V), dépose ou choisit l'image obtenue : elle est enregistrée comme ressource nommée comme la carte et reliée à la carte : si le modèle de la carte choisit son image par un attribut (`{{index assets card.illustration}}` par ex.), le nom de la ressource est écrit dans cet attribut pour cette carte seulement.

La génération directe dans l'application, décrite ci-dessous, nécessite un service d'images : les clés gratuites d'OpenAI et de Gemini ne donnent pas accès à la génération d'images par API.

Le serveur peut générer les illustrations des cartes avec **OpenAI**, **Google Gemini** ou un **ComfyUI** local. Un service est disponible dès que sa clé (ou son URL) est renseignée ; avec plusieurs services, l'utilisateur choisit dans la fenêtre de génération, `CIDER_IMAGE_PROVIDER` fixant celui proposé par défaut.

**Tout se règle aussi depuis l'interface** : menu **Paramètres IA** (administrateurs). Services, clés, modèles, qualité, délai, quota des nouveaux comptes, workflow ComfyUI et **modèle de prompt**. Les variables ci-dessous ne sont que les valeurs de départ : ce qui est modifié dans l'interface est enregistré dans `ai-settings.json` (dossier de données) et prend le dessus, sans redémarrage. Le bouton « Revenir aux valeurs Docker » efface ces réglages. Les clés saisies dans l'interface sont stockées en clair dans ce fichier (lisible uniquement par le serveur) et ne sont jamais réaffichées : protéger le dossier de données en conséquence.

**Modèle de prompt** : texte envoyé au service pour chaque illustration, qui oriente toutes les générations (type d'image, cadrage, contraintes). Variables disponibles : `{{subject}}` (obligatoire, le sujet saisi), `{{style}}` (style du projet), `{{card_name}}` (nom de la carte), `{{no_text}}` (consigne « pas de texte » si la case est cochée). Une ligne dont toutes les variables sont vides est retirée. La fenêtre de génération affiche le prompt final avant l'envoi.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `CIDER_IMAGE_PROVIDER` | *(premier configuré)* | Service par défaut : `openai`, `gemini` ou `comfyui` |
| `CIDER_AI_DEFAULT_MONTHLY_IMAGES` | `50` | Quota mensuel donné aux nouveaux comptes |
| `CIDER_AI_PROMPT_TEMPLATE` | *(modèle intégré)* | Modèle de prompt de départ ; `\n` pour un retour à la ligne |
| `CIDER_AI_TIMEOUT_SECONDS` | `180` | Délai maximal d'une génération (rester sous 300 s, délai de nginx) |
| `OPENAI_API_KEY` / `OPENAI_IMAGE_MODEL` / `OPENAI_IMAGE_QUALITY` | — / `gpt-image-2` / `medium` | OpenAI ; qualité `low`, `medium` ou `high` |
| `GEMINI_API_KEY` / `GEMINI_IMAGE_MODEL` | — / `gemini-3.1-flash-image` | Google Gemini |
| `COMFYUI_URL` / `COMFYUI_CHECKPOINT` / `COMFYUI_WORKFLOW_FILE` | — / `sd_xl_base_1.0.safetensors` / — | ComfyUI local, ex. `http://192.168.1.20:8188` |

Les noms de modèles évoluent vite : ils sont modifiables sans toucher au code.

**Accès** : l'IA est désactivée pour chaque compte par défaut. Dans **Utilisateurs**, l'administrateur l'active compte par compte et clique sur le compteur `x / y images` pour changer le quota mensuel (mois calendaire UTC ; `0` bloque la génération). Une génération échouée n'est pas décomptée ; un utilisateur ne peut lancer qu'une génération à la fois.

**Utilisation** : dans la vue **Cartes** (miniatures), survoler une carte et cliquer sur ✨. On décrit un style commun au projet (mémorisé), le sujet est pré-rempli depuis le nom et la description de la carte. L'image choisie est enregistrée comme ressource **nommée comme la carte** : un modèle qui affiche `{{index assets card.name}}` la montre aussitôt.

**Coûts et confidentialité** : OpenAI et Gemini facturent chaque image (le quota sert aussi de garde-fou budgétaire) et reçoivent le texte de la demande. Les clés restent dans le conteneur `api` et ne sont jamais transmises au navigateur. ComfyUI reste entièrement local.

**Workflow ComfyUI personnalisé** : exporter le workflow au format API (*Export (API)*), le placer dans le dossier de données et indiquer son chemin dans le conteneur (`COMFYUI_WORKFLOW_FILE=/data/comfyui-workflow.json`). Les valeurs suivantes y sont remplacées : `{{prompt}}`, `{{negative_prompt}}`, `{{seed}}`, `{{width}}`, `{{height}}`, `{{batch_size}}`, `{{checkpoint}}`. Sans fichier, un workflow SDXL simple est utilisé.

## Sécurité

- **Servir l'application en HTTPS** (via un reverse proxy) dès qu'elle est accessible hors du réseau local : identifiants et cookie de session circulent sinon en clair. Mettre alors `CIDER_COOKIE_SECURE=true`.
- Connexion limitée à 10 tentatives par minute et par adresse ; cookie de session `HttpOnly` et `SameSite=Strict` ; en-tête anti-CSRF exigé par l'API. Derrière un reverse proxy en amont (celui du Synology par exemple), toutes les connexions arrivent avec l'adresse du proxy : la limite de 10 tentatives par minute s'applique alors à l'ensemble des utilisateurs.
- **En-têtes de sécurité** : nginx envoie une Content-Security-Policy (`docker/security-headers.conf`). Les scripts ne peuvent venir que du serveur lui-même ; images, polices et feuilles de style externes en https restent autorisées pour les modèles de cartes.
- **Modèles de cartes** : le HTML des cartes est nettoyé avant affichage (DOMPurify). Scripts, attributs `on…`, `<link>`, `<iframe>`, `<form>`, `<object>` et `<foreignObject>` sont retirés. Pour une police externe, utiliser `@import url(...)` dans le CSS du modèle ou dans le document `global-styles`.

## Reprendre les projets de CIDEr d'origine

Dans **Mes projets > Importer un projet**, trois sources sont acceptées ; chaque import crée un nouveau projet :

- **Version web (.json)** : les projets de la version web restaient dans le navigateur. Avec l'ancienne version, **Fichier > Avancé > Exporter la base de données**, puis importer le fichier obtenu. Les exports des toutes premières versions (tables `games`) sont convertis automatiquement.
- **Version desktop (dossier)** : choisir le dossier du projet, celui qui contient `decks/` et `assets/` (le navigateur demande de confirmer l'envoi des fichiers). Sont repris les documents (`.md`, `.css`), les ressources avec leurs sous-dossiers, et pour chaque deck les attributs (`attributes.csv`), les cartes (`cards.csv`) et les modèles (`.html` + `.css`).
- **Version desktop (.zip)** : le même dossier compressé, pratique si le navigateur refuse le choix d'un dossier.

L'opération inverse existe aussi : dans un projet, **Fichier > Télécharger en dossier (.zip, format desktop)** produit ce même dossier, avec des CSV modifiables dans un tableur et réimportables.
