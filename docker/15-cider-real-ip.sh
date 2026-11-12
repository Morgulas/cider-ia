#!/bin/sh
# Lancé par l'image nginx au démarrage (dossier /docker-entrypoint.d), avant le
# traitement des modèles de configuration.
#
# Derrière un reverse proxy (Nginx Proxy Manager, proxy du Synology…), toutes les
# requêtes arrivent avec l'adresse du proxy : la limite de tentatives de connexion
# s'appliquerait alors à tous les utilisateurs ensemble. CIDER_REVERSE_PROXY_IPS
# donne les adresses de ce proxy (IP ou plage CIDR, séparées par des virgules ou
# des espaces) : pour les requêtes venant de lui, nginx prend l'adresse du client
# dans l'en-tête X-Forwarded-For qu'il ajoute.
#
# Ne mettre que le proxy : une adresse de confiance peut choisir l'adresse du
# client qu'elle annonce. Vide (par défaut) : l'en-tête n'est jamais lu.
set -eu

SNIPPET=/etc/nginx/snippets/real-ip.conf
mkdir -p "$(dirname "$SNIPPET")"

entries=$(printf '%s' "${CIDER_REVERSE_PROXY_IPS:-}" | tr ',' ' ')
{
  echo "# généré au démarrage depuis CIDER_REVERSE_PROXY_IPS"
  count=0
  for entry in $entries; do
    # IPv4 ou IPv6, avec ou sans /masque : rien d'autre n'entre dans la configuration
    if ! printf '%s' "$entry" | grep -Eq '^([0-9]{1,3}(\.[0-9]{1,3}){3}|[0-9A-Fa-f:]*:[0-9A-Fa-f:.]*)(/[0-9]{1,3})?$'; then
      echo "CIDER_REVERSE_PROXY_IPS : « $entry » n'est pas une adresse IP ou une plage CIDR" >&2
      exit 1
    fi
    echo "set_real_ip_from $entry;"
    count=$((count + 1))
  done
  if [ "$count" -gt 0 ]; then
    echo "real_ip_header X-Forwarded-For;"
    # ignore aussi les autres proxys de confiance de la chaîne : on garde la première adresse inconnue
    echo "real_ip_recursive on;"
  fi
} > "$SNIPPET.tmp"
mv "$SNIPPET.tmp" "$SNIPPET"

if [ -n "$entries" ]; then
  echo "cider-ia : adresse du client lue dans X-Forwarded-For pour les requêtes venant de :" $entries
fi
