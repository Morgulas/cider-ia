# Sauvegarde et restauration des données

Tout ce que l'application enregistre est dans le **dossier de données** (`CIDER_DATA_PATH` dans `.env`, monté sur `/data` dans le conteneur `api`) : comptes, sessions, projets, versions conservées et images. Le sauvegarder suffit pour tout récupérer ; l'application elle-même ne fait pas de sauvegarde.

## Ce qu'il faut savoir

- **`projects/` et `blobs/` vont ensemble.** Les images d'un projet ne sont pas dans son fichier mais dans `blobs/` : un projet restauré sans les `blobs/` de la même sauvegarde s'ouvre sans ses images.
- **Les conteneurs peuvent rester démarrés.** Chaque fichier est écrit d'un bloc (fichier temporaire puis renommage) : aucun fichier n'est jamais copié à moitié écrit.
- **L'ordre compte.** Une image est toujours envoyée avant le projet qui l'utilise. Une copie qui prend tout le reste avant `blobs/` est donc toujours cohérente. Un outil qui copie dans son propre ordre (Hyper Backup, rsync) peut, si un enregistrement a lieu pendant la copie, garder un projet plus récent que ses images : le planifier à une heure sans travail en cours, ou sauvegarder les archives produites par le script ci-dessous.
- Les **téléchargements** de projets (page Projets) sont des exports complets, utiles pour garder un projet à part, mais ils ne remplacent pas la sauvegarde du dossier (comptes, versions conservées).

## Méthode 1 : le script `backup.sh`

[`docker/backup.sh`](../docker/backup.sh) crée une archive datée `cider-data_AAAA-MM-JJ_HHMMSS.tar.gz`, dans le bon ordre, la relit en entier, puis supprime les archives de plus de 14 jours (`KEEP_DAYS`, `0` pour tout garder).

```bash
sudo ./docker/backup.sh /chemin/vers/le/dossier/de/donnees /chemin/vers/les/sauvegardes
KEEP_DAYS=30 sudo ./docker/backup.sh /chemin/vers/le/dossier/de/donnees /chemin/vers/les/sauvegardes
```

`sudo` est nécessaire si le dossier n'est lisible que par l'utilisateur `PUID` (cas par défaut).

Si le dépôt n'est pas cloné sur la machine (déploiement par Dockhand), récupérer le script seul :

```bash
curl -fsSLo backup.sh https://raw.githubusercontent.com/Morgulas/cider-ia/main/docker/backup.sh
chmod +x backup.sh
```

**Tous les jours avec cron** (sur la machine Docker), par exemple à 3 h :

```cron
0 3 * * * /opt/cider-ia/docker/backup.sh /srv/cider-ia/data /srv/sauvegardes/cider-ia >> /var/log/cider-backup.log 2>&1
```

**Sur un NAS Synology** : Panneau de configuration → Planificateur de tâches → Créer → Tâche planifiée → Script défini par l'utilisateur, utilisateur `root`, avec la même commande. Le dossier des archives peut ensuite être envoyé ailleurs par Hyper Backup (autre disque, autre NAS, cloud) : c'est la combinaison la plus sûre.

## Méthode 2 : Hyper Backup directement sur le dossier

Si le dossier de données est sur le Synology, une tâche Hyper Backup qui l'inclut en entier convient, à condition de :

- inclure tout le dossier (`users.json`, `sessions.json`, `projects/`, `blobs/` et le reste), jamais `projects/` seul ;
- la planifier la nuit, quand personne n'édite (voir « L'ordre compte ») ;
- garder plusieurs versions (rotation) pour pouvoir revenir avant une erreur.

## Restaurer

1. Arrêter l'application : `docker compose down` (ou arrêter la pile dans Dockhand).
2. Mettre de côté le dossier actuel plutôt que de l'effacer : `mv data data.avant-restauration`.
3. Extraire la sauvegarde à la place :
   ```bash
   mkdir data
   tar -xzf /chemin/vers/les/sauvegardes/cider-data_2026-11-06_030000.tar.gz -C data
   ```
   (avec Hyper Backup : restaurer le dossier entier, `projects/` et `blobs/` de la même version.)
4. Vérifier la copie restaurée, sans rien modifier :
   ```bash
   docker run --rm --entrypoint node -v "$PWD/data:/data:ro" \
     ghcr.io/morgulas/cider-ia-api:latest dist/tools/check-data.js /data
   ```
   La dernière ligne doit être « Tout est bon ».
5. Redémarrer : `docker compose up -d`. Le conteneur `api` redonne le dossier à l'utilisateur `PUID:PGID` au démarrage : pas besoin de `chown`.

Après une restauration, si un navigateur avait encore des modifications non envoyées sur un projet restauré, l'application demande quelle version garder, comme pour une modification depuis deux appareils.

## Tester une sauvegarde

Une sauvegarde qu'on n'a jamais relue n'en est pas vraiment une. De temps en temps, extraire une archive dans un dossier temporaire et lancer `check-data` dessus (étape 4) : cela vérifie que chaque projet se relit avec toutes ses images, sans toucher à l'instance en service.
