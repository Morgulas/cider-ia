# Déploiement Docker

Version web de Cider servie par nginx (application statique, sans backend).

```bash
docker compose up -d --build
```

Puis ouvrir http://<hôte>:8080. Le port se change via la variable `CIDER_PORT`.

## À savoir

- **Les projets sont stockés dans le navigateur** de chaque utilisateur (IndexedDB), pas sur le serveur. Il n'y a donc aucun volume à monter. Vider le cache du navigateur efface les projets : utiliser l'export de projet pour les sauvegarder.
- Le premier build prend quelques minutes (≈950 paquets npm, application finale ≈150 Mo).
