# Documentation de cider-ia

## Utiliser

| Page | Contenu |
| :--- | :--- |
| [interface.md](interface.md) | Se repérer : barre d'activité, Explorateur et sélecteur de deck, onglets du deck, panneau Illustrations. |
| [editeur-de-modeles.md](editeur-de-modeles.md) | Éditeur de modèles de carte : code, insertion, aperçus, inspecteur, réglages, chatbot. |
| [format-cartes-fangh.md](format-cartes-fangh.md) | Importer et exporter des cartes (CSV, JSON), synchronisation, historique, **publier un set pour l'appli de collection**. |
| [boosters.md](boosters.md) | Simulateur de boosters : pool et poids, design recto/verso du sachet, ouverture, statistiques. |
| [simulateur.md](simulateur.md) | Simulateur de partie : zones, joueurs, mains, boosters, journal, parties enregistrées. |

## Installer et exploiter

| Page | Contenu |
| :--- | :--- |
| [../docker/README.md](../docker/README.md) | Déploiement Docker, variables, dossier de données, comptes, IA (illustrations), sécurité, reprise des projets de CIDEr d'origine. |
| [sauvegarde.md](sauvegarde.md) | Sauvegarder, restaurer et vérifier le dossier de données. |

## Développer

| Page | Contenu |
| :--- | :--- |
| [developpement.md](developpement.md) | Organisation du code, fonctionnement, API du serveur, commandes, tests, CI et déploiement, pièges connus. |

## Le reste de l'écosystème

Les sets publiés depuis cider-ia s'importent dans **[card-collector](https://github.com/Morgulas/card-collector)**, l'appli mobile de collection (ouverture de boosters, classeur des joueurs). Sa documentation est dans son propre dépôt.

```
cider-ia                                card-collector
conception des cartes ──▶ Exporter ──▶ Admin › Importer un set ──▶ boosters et classeurs des joueurs
(decks, modèles, boosters)  « Set pour l'appli
                             de collection » (ZIP)
```
