# Simulateur de jeu

Icône **couronne** dans la barre de gauche. La table reprend tous les decks du projet en piles ; le clic droit ouvre les menus (table, pile, carte, zone). La molette zoome, Maj + glisser déplace la vue.

## Barre d'outils

En haut à gauche : panneau des joueurs, journal, nouvelle zone, ouverture d'un booster, parties enregistrées, puis le tour en cours, le joueur actif et **Fin du tour**.

## Joueurs et compteurs

Le panneau **Joueurs** liste les joueurs (nom modifiable, couleur, nombre de cartes en main). Chaque joueur a des compteurs (PV au départ) avec − et + ; on peut en ajouter et les renommer. Le rond coloré donne la main à ce joueur ; **Fin du tour** passe au suivant et compte les tours. « Réinitialiser le jeu » vide les mains et remet les compteurs à leur valeur de départ.

## Mains

La barre du bas montre la main d'un joueur (un onglet par joueur) :

- remplir : clic droit sur une pile → **Piocher dans la main de…** ou **Distribuer à chaque joueur**, ou glisser une carte de la table sur la barre (ou clic droit → Prendre en main) ;
- jouer : glisser la carte sur la table (Maj enfoncée : face cachée), ou cliquer dessus : jouer, jouer face cachée, défausser, donner à un autre joueur.

## Zones

Clic droit sur la table → **Ajouter une zone** (ou le bouton de la barre). Une zone se déplace par son bandeau (ses cartes suivent), se redimensionne par le coin en bas à droite, et son menu (clic droit sur le bandeau ou « … ») règle :

- la **disposition** des cartes posées : libre, en ligne, en grille, en cascade ;
- leur **face** : inchangée, toujours visible, toujours cachée ;
- le **joueur** propriétaire et la couleur ;
- **Ranger les cartes**, **Réunir en une pile**, supprimer la zone (les cartes restent sur la table).

Le bandeau affiche le nombre de cartes de la zone.

## Boosters

Clic droit sur la table → **Ouvrir un booster ici**, ou le bouton cadeau : le booster arrive en pile face cachée sur la table, ou directement dans la main d'un joueur. Les cartes foil sont holographiques. Les boosters se configurent dans le simulateur de boosters ([boosters.md](boosters.md)).

## Journal

Les pioches, cartes jouées et défaussées, mélanges, dés, pièces, compteurs, boosters et fins de tour s'inscrivent dans le **Journal**, avec l'heure et la couleur du joueur.

## Parties enregistrées

Le bouton disquette enregistre la partie dans le projet : table, piles, zones, joueurs, mains, compteurs, journal et vue. **Charger** la rétablit, en mélangeant si on veut les piles face cachée : une partie enregistrée au début sert ainsi de **mise en place** réutilisable. Les cartes supprimées du projet depuis sont ignorées (un message le signale).
