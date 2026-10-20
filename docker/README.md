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

## Sécurité

- **Servir l'application en HTTPS** (via un reverse proxy) dès qu'elle est accessible hors du réseau local : identifiants et cookie de session circulent sinon en clair. Mettre alors `CIDER_COOKIE_SECURE=true`.
- Connexion limitée à 10 tentatives par minute et par adresse ; cookie de session `HttpOnly` et `SameSite=Strict` ; en-tête anti-CSRF exigé par l'API. Derrière un reverse proxy en amont (celui du Synology par exemple), toutes les connexions arrivent avec l'adresse du proxy : la limite de 10 tentatives par minute s'applique alors à l'ensemble des utilisateurs.
- **En-têtes de sécurité** : nginx envoie une Content-Security-Policy (`docker/security-headers.conf`). Les scripts ne peuvent venir que du serveur lui-même ; images, polices et feuilles de style externes en https restent autorisées pour les modèles de cartes.
- **Modèles de cartes** : le HTML des cartes est nettoyé avant affichage (DOMPurify). Scripts, attributs `on…`, `<link>`, `<iframe>`, `<form>`, `<object>` et `<foreignObject>` sont retirés. Pour une police externe, utiliser `@import url(...)` dans le CSS du modèle ou dans le document `global-styles`.

## Mise à jour depuis la version sans serveur

Les projets de l'ancienne version restaient dans le navigateur. Pour les récupérer : avec l'ancienne version, **Fichier > Avancé > Exporter la base de données**, puis dans la nouvelle, **Mes projets > Importer un projet**.
