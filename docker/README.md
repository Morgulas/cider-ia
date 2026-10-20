# Déploiement Docker

Version web de Cider servie par nginx (application statique, sans backend).

```bash
docker compose up -d --build
```

Puis ouvrir http://<hôte>:8080. Le port se change via la variable `CIDER_PORT`.

## À savoir

- **Les projets sont stockés dans le navigateur** de chaque utilisateur (IndexedDB), pas sur le serveur. Il n'y a donc aucun volume à monter. Vider le cache du navigateur efface les projets : utiliser l'export de la base pour les sauvegarder.
- **Servir l'application en HTTPS** (via un reverse proxy) ou depuis `localhost`. Au démarrage, l'application demande au navigateur de ne pas évincer ses données (stockage persistant), mais cette API n'existe que dans un contexte sécurisé : en HTTP simple sur le réseau local, le navigateur peut effacer les projets s'il manque d'espace disque.
- **En-têtes de sécurité** : nginx envoie une Content-Security-Policy (`docker/security-headers.conf`). Les scripts ne peuvent venir que du serveur lui-même ; images, polices et feuilles de style externes en https restent autorisées pour les modèles de cartes. Si un modèle ne s'affiche plus correctement, la console du navigateur indique la ressource bloquée.
- Le premier build prend quelques minutes (≈950 paquets npm, application finale ≈60 Mo).
