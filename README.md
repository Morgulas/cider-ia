<div align="center">

<img src="cider-app/src/assets/cider-logo-512.png" alt="Logo Oatear Cider" width="150">

# Oatear Cider

### Le studio de conception de cartes piloté par les données, pour les créateurs de jeux

Concevez de belles cartes de jeu avec la puissance et la simplicité de `HTML`, `CSS` et `Handlebars`. Oatear Cider est un environnement de développement moderne pour créer des jeux de cartes, à mi-chemin entre les éditeurs simples et les logiciels professionnels complexes.

[![][license]][license-url] 
[![][stars]][gh-url]
[![][release]][releases-url]
[![][downloads]][releases-url]
[![][last-commit]][gh-url]
[![][website]][pages-url]
[![][discord]][discord-url]

</div>

> **Fork `cider-ia`** — fork de [Oatear Cider](https://github.com/oatear/cider) en version web uniquement (la version desktop/Electron a été retirée), auquel on ajoute des fonctionnalités d'IA.

---

## Pour commencer

| Plateforme / action | Lien | Description |
| :--- | :--- | :--- |
| **Application web** | **[L'essayer dans votre navigateur][pages-url]** | L'expérience complète, directement dans votre navigateur, sans installation (version d'origine, sans les modifications de ce fork). |
| **Documentation** | **[Documentation de Cider][cider-docs-url]** | Une documentation détaillée de toutes les fonctions de Cider, avec un guide de démarrage rapide. |
| **Nous soutenir** | [<img src="cider-app/src/assets/kofi-badge.png" alt="Soutenir Oatear sur Ko-fi" width="160">][kofi-url] | Si Cider vous est utile, pensez à faire un petit don pour soutenir son développement ! |

---

## À propos d'Oatear Cider

Cider a été créé pour les concepteurs qui veulent une liberté créative totale sans courbe d'apprentissage abrupte. Au lieu d'un éditeur graphique limité, Cider utilise des outils que vous connaissez déjà :

-   **Structurer avec HTML :** définissez la mise en page de vos cartes en HTML standard.
-   **Mettre en forme avec CSS :** appliquez des styles riches, des polices et couleurs jusqu'aux mises en page complexes comme CSS Grid.
-   **Ajouter de la logique avec Handlebars :** utilisez les données d'un tableur pour faire varier les noms, les statistiques et les capacités.
-   **Voir un projet d'exemple :** découvrez le projet **[Cosmic Apple][cosmic-apple]** pour voir comment tout s'articule.

![Capture d'écran de Cider][screen-1]

## Fonctionnalités principales

| Fonctionnalité | Description | Capture d'écran |
| :--- | :--- | :--- |
| **1. Des modèles puissants** | Créez des modèles de cartes réutilisables en HTML et CSS. L'assistant de modèles vous aide à mettre en place rapidement les formats et mises en page de cartes standard. | ![Éditeur de modèles][screen-2] |
| **2. Une conception pilotée par les données** | Séparez la mise en forme du contenu. Gérez tous les attributs des cartes dans une interface simple, proche d'un tableur. Modifiez une donnée à un seul endroit et mettez à jour des centaines de cartes d'un coup. | ![Éditeur de données tabulaires][screen-3] |
| **3. Aperçu en direct** | Voyez vos cartes se mettre à jour en temps réel pendant que vous modifiez vos modèles ou vos données. Plus besoin de deviner le résultat. | ![Aperçu en direct][screen-4] |
| **4. Simulateur intégré** | Testez votre jeu immédiatement dans le **simulateur de partie** : mélangez, piochez et défaussez sans rien imprimer. Le **générateur d'assets** vous aide à créer des illustrations et symboles provisoires. | ![Simulateur de partie][screen-7] |
| **5. Exports de qualité professionnelle** | Exportez vos cartes en PNG ou en planches PDF prêtes à imprimer, avec traits de coupe et mode économie d'encre. Vous pouvez aussi exporter pour des tables virtuelles comme Tabletop Simulator. | ![Options d'export][screen-5] |

## Installation et utilisation

### Auto-hébergement (Docker)
Ce fork fonctionne uniquement comme application web, avec un serveur : **comptes utilisateurs** (créés par un administrateur) et **projets enregistrés sur le serveur**, accessibles depuis n'importe quel navigateur. Le dossier de données se choisit dans le `docker-compose`. Voir [`docker/README.md`](docker/README.md) :
```bash
cp .env.example .env
docker compose up -d --build
```

### Version web d'origine
La version d'origine, sans serveur, est disponible sur **[oatear.github.io/cider][pages-url]** : les projets y sont stockés dans le navigateur. Un projet s'échange entre les deux versions sous forme de fichier `database.json`.

## Propriété des créations et licence
Tout ce que vous créez avec Oatear Cider est votre propriété intellectuelle. L'application ne collecte aucune donnée et tout votre travail reste sur votre appareil.

Le code source de l'application est protégé par la **[licence AGPL-3.0][license-url]**, afin qu'il reste open source pour toujours.

## Contribuer
Les contributions de la communauté sont les bienvenues ! Qu'il s'agisse de signaler un bug, de proposer une fonctionnalité ou d'écrire du code, votre aide est appréciée.

Une autre excellente façon de contribuer est de **[soutenir financièrement le projet d'origine][kofi-url]**. Les dons aident à couvrir des frais comme l'abonnement au programme développeur d'Apple et permettent de consacrer plus de temps au développement.

-   **Bugs et demandes de fonctionnalités :** ouvrez une issue sur la **[page GitHub Issues du projet d'origine](https://github.com/oatear/cider/issues)**, ou sur [celle de ce fork](https://github.com/Morgulas/cider-ia/issues) pour ce qui concerne ses ajouts.
-   **Développement :** pour lancer le projet en local, il faut Node.js et Angular CLI.
    ```bash
    # Cloner le dépôt
    git clone https://github.com/Morgulas/cider-ia.git
    cd cider-ia/cider-app

    # Installer les dépendances
    npm ci

    # Lancer le serveur (dans un autre terminal)
    cd ../cider-server && npm ci && CIDER_DATA_DIR=./data npm run dev

    # Lancer l'application en mode développement (relaie /api vers le serveur)
    cd ../cider-app && npm start
    ```

---

<!-- BADGE & IMAGE DEFINITIONS -->
[last-commit]: https://img.shields.io/github/last-commit/oatear/cider
[license]: https://badgen.net/github/license/oatear/cider?cache=600
[stars]: https://img.shields.io/github/stars/oatear/cider
[release]: https://img.shields.io/github/v/release/oatear/cider
[discord]: https://img.shields.io/discord/1129380421642240133?logo=discord&label=discord&color=%23515fe4&link=https%3A%2F%2Fdiscord.gg%2FS66xw9Wc9V
[downloads]: https://img.shields.io/github/downloads/oatear/cider/total
[website]: https://img.shields.io/website?down_color=red&down_message=offline&up_color=green&up_message=online&url=https%3A%2F%2Foatear.github.io%2Fcider
[mac-app-store-badge]: cider-app/src/assets/mac-app-store-badge.svg
[kofi-badge]: cider-app/src/assets/kofi-badge.png
[screen-1]: cider-app/src/assets/screen-1.png
[screen-2]: cider-app/src/assets/screen-2.png
[screen-3]: cider-app/src/assets/screen-3.png
[screen-4]: cider-app/src/assets/screen-4.png
[screen-5]: cider-app/src/assets/screen-5.png
[screen-7]: cider-app/src/assets/screen-7.png
[image-file-tree]: cider-app/src/assets/image-file-tree.png

<!-- URL DEFINITIONS -->
[gh-url]: https://github.com/oatear/cider
[releases-url]: https://github.com/oatear/cider/releases
[cosmic-apple]: https://github.com/oatear/cosmic-apple-game
[cider-docs-url]: https://oatear.github.io/cider-docs/docs/overview/
[license-url]: LICENSE.md
[pages-url]: https://oatear.github.io/cider
[discord-url]: https://discord.gg/S66xw9Wc9V
[mac-app-store-url]: https://apps.apple.com/us/app/oatear-cider/id6749406996?mt=12
[kofi-url]: https://ko-fi.com/oatear