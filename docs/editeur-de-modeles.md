# Éditeur de modèles

L'éditeur de modèles (dans l'Explorateur, **Modèles de carte** sous le deck, puis un modèle ; ou l'onglet **Modèles de carte** en haut des pages du deck) a le code à gauche (HTML et CSS) et l'aperçu de la carte à droite. Chaque frappe met l'aperçu à jour. Ce guide décrit ce que le fork ajoute à l'éditeur d'origine.

## Le code

- **Onglets ou côte à côte** : les deux boutons au-dessus du code affichent HTML et CSS l'un au-dessus de l'autre, ou en onglets (plus de place pour chacun).
- **Mise en forme** : le bouton de mise en forme (ou **Maj+Alt+F**) réindente le HTML et le CSS.
- **Enregistrement** : le modèle s'enregistre tout seul. **Ctrl+S** (ou le bouton « Enregistrer maintenant ») enregistre tout de suite. Si l'enregistrement échoue, un message l'indique.
- **Complétion** : en tapant `{{`, l'éditeur propose les champs de la carte (`card.nom`…), les helpers et les images du projet. Chaque helper proposé est accompagné de son rôle et d'un exemple.
- **Erreurs** : un bloc `{{#if}}` jamais fermé, des noms de bloc qui ne correspondent pas ou des accolades non refermées sont soulignés à la bonne ligne. Tant que le code est faux, l'aperçu garde la dernière version valide ; un bandeau le signale, et un clic dessus montre l'erreur.

## Insérer

Le bouton **Insérer** ouvre un panneau ; un clic insère l'élément à l'endroit du curseur :

- **Champs de la carte** : tous les attributs du deck, avec la valeur de la carte d'aperçu en exemple.
- **Blocs** : « si le champ est rempli », « si… sinon… », « si le champ vaut… », « répéter N fois », « image nommée dans un champ », « texte avec icônes ».
- **Images** : les images du projet, avec un filtre. Dans le HTML, l'image est insérée en `<img src="{{assets.nom}}" alt="">` ; dans le CSS, en `url("{{assets.nom}}")`.

## L'aperçu

Les boutons au-dessus de l'aperçu choisissent la carte (précédente, suivante) et la vue :

| Vue | Ce qu'elle montre |
| :--- | :--- |
| **Carte** | La carte d'aperçu, comme avant. |
| **Recto/verso** | Le recto et le verso de la carte côte à côte, quand elle utilise ce modèle pour l'un des deux. |
| **Débordements** | Le modèle appliqué aux cartes qui risquent le plus de déborder : le texte le plus long et le plus court, et la valeur la plus longue de chaque champ. Les zones dont le texte dépasse sont encadrées en rouge, avec un résumé (« texte qui dépasse sur 3 carte(s) sur 8 »). |

Le bouton **Ajuster** met la carte à la taille de la zone d'aperçu. Les **réglages de l'aperçu** affichent les traits de coupe et la zone de sécurité.

## Inspecter

Avec **Inspecter** activé, survoler l'aperçu encadre les éléments ; un clic sur un élément :

- place le curseur sur sa ligne dans le HTML ;
- liste les règles CSS qui le ciblent (un clic sur une règle y amène le curseur).

Dans l'autre sens, la ligne où se trouve le curseur (balise HTML ou règle CSS) encadre en orange les éléments concernés dans l'aperçu.

## Réglages

L'onglet **Réglages** liste les variables CSS du modèle (par exemple `--couleur-titre: #b8860b;`) avec un sélecteur adapté : couleur, curseur pour les tailles, champ texte sinon. Modifier une valeur réécrit la ligne du CSS. Pour régler un modèle sans toucher au code, il suffit donc d'en sortir les couleurs et tailles importantes dans des variables en tête du CSS :

```css
.card {
  --couleur-titre: #b8860b;
  --taille-titre: 18px;
}
.titre { color: var(--couleur-titre); font-size: var(--taille-titre); }
```

## Fenêtre séparée (second écran)

Le bouton **Ouvrir l'aperçu dans une fenêtre** déplace l'aperçu dans une fenêtre à part, à mettre sur un second écran. Le code prend alors toute la largeur de la page. Toutes les vues (carte, recto/verso, débordements) et l'inspecteur fonctionnent dans la fenêtre, pilotés par les boutons restés dans la page. « Ramener l'aperçu ici » (ou fermer la fenêtre) le remet à sa place.

Si rien ne s'ouvre, le navigateur a bloqué la fenêtre : autoriser les fenêtres pop-up pour le site.

## Modifier avec un chatbot

**Modifier avec un chatbot** prépare un prompt pour ChatGPT, Le Chat, Gemini… sans clé d'API :

1. Décrire la modification voulue (« mets le niveau dans un médaillon rond en haut à droite »), puis **Copier le prompt**. Il contient le HTML et le CSS actuels, les champs du deck avec les valeurs de la carte d'aperçu, les images du projet, les helpers et les règles à respecter.
2. Coller le prompt dans le chatbot, puis coller **toute** sa réponse dans la fenêtre : les blocs ` ```html ` et ` ```css ` sont repérés automatiquement.
3. Comparer avant/après, puis **Appliquer**. **Ctrl+Z** dans l'éditeur revient à la version précédente.
