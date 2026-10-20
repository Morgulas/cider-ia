#!/bin/sh
# Le dossier de données est monté depuis l'hôte (docker-compose : CIDER_DATA_PATH).
# Le serveur tourne sous l'utilisateur "node" (uid/gid PUID/PGID, 1000 par défaut) :
# on lui donne le dossier, puis on abandonne les droits root.
set -e
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
DATA_DIR="${CIDER_DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  if [ "$PUID" = "0" ] || [ "$PGID" = "0" ]; then
    echo "PUID et PGID ne peuvent pas valoir 0 : le serveur ne doit pas tourner en root." >&2
    exit 1
  fi
  if [ "$PGID" != "$(id -g node)" ]; then
    sed -i "s/^node:x:[0-9]*:/node:x:${PGID}:/" /etc/group
    sed -i "s/^\(node:x:[0-9]*\):[0-9]*:/\1:${PGID}:/" /etc/passwd
  fi
  if [ "$PUID" != "$(id -u node)" ]; then
    sed -i "s/^node:x:[0-9]*:/node:x:${PUID}:/" /etc/passwd
  fi
  mkdir -p "$DATA_DIR"
  # ne change que les fichiers qui n'appartiennent pas déjà à node (rapide sur un gros dossier)
  find "$DATA_DIR" \( ! -user node -o ! -group node \) -exec chown node:node {} +
  chmod 700 "$DATA_DIR"
  exec su-exec node "$@"
fi
exec "$@"
